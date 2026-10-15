// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { JwtPayload } from '../auth.types';
import { hasTenantClaims } from '../membership';
import { JWT_EXPIRES_IN_SECONDS } from '../jwt.config';
import { UserSessionsRevokedEvent } from './user-sessions-revoked.event';

/** How long a process trusts its local view of a user's stale marker. */
export const STALE_MARKER_LOCAL_TTL_MS = 5_000;

const staleKey = (userId: string) => `auth:stale:${userId}`;

type LocalEntry = { staleAt: number | null; checkedAt: number };

/**
 * Invalidates the memberships embedded in a user's tokens without a token
 * store: `revoke` writes a per-user "stale since" marker (Redis via the global
 * cache, TTL = token lifetime) and kicks the user's sockets. A token issued
 * before the marker is rejected with `token_stale`, so the client refreshes
 * its memberships transparently.
 *
 * The hot path (`isStale`, every authenticated request) answers from a
 * per-process map for a few seconds before asking the shared cache again.
 */
@Injectable()
export class SessionRevocationService {
  private readonly local = new Map<string, LocalEntry>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionRevocationService.name);
  }

  /** Marks every token of the user issued until now as stale and drops their sockets. */
  async revoke(userId: string, now = Date.now()): Promise<void> {
    this.local.set(userId, { staleAt: now, checkedAt: now });
    try {
      await this.cache.set(staleKey(userId), now, JWT_EXPIRES_IN_SECONDS * 1000);
    } catch (error) {
      // The local marker still protects this process; log so ops can see it.
      this.logger.error({ error: String(error), userId }, 'Failed to persist stale marker');
    }

    this.eventBus.publish(new UserSessionsRevokedEvent(userId));
  }

  /**
   * A token is stale when it predates the tenant claims or was issued before
   * the user's latest revocation.
   */
  async isStale(payload: Partial<JwtPayload>, now = Date.now()): Promise<boolean> {
    if (!payload.sub || !hasTenantClaims(payload)) return true;

    const staleAt = await this.staleSince(payload.sub, now);

    return staleAt !== null && (payload.ts as number) < staleAt;
  }

  private async staleSince(userId: string, now: number): Promise<number | null> {
    const cached = this.local.get(userId);
    if (cached && now - cached.checkedAt < STALE_MARKER_LOCAL_TTL_MS) {
      return cached.staleAt;
    }

    let staleAt: number | null = null;
    try {
      staleAt = (await this.cache.get<number>(staleKey(userId))) ?? null;
    } catch (error) {
      // Fail open on a cache outage: the token signature is still verified.
      this.logger.warn({ error: String(error), userId }, 'Stale marker lookup failed');
      staleAt = cached?.staleAt ?? null;
    }

    this.local.set(userId, { staleAt, checkedAt: now });
    return staleAt;
  }
}
