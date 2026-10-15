// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { APP_REDIS, type AppRedis } from '@common/redis/app-redis.module';
import type { AnalyticsScope } from '@contracts';

/** How long a computing request holds the single-flight lock. */
const LOCK_MS = 5_000;
/** Followers poll the leader's result this many times before computing. */
const FOLLOW_ATTEMPTS = 10;
const FOLLOW_DELAY_MS = 100;

export const versionKey = (companyId: string, scope: AnalyticsScope) =>
  `analytics:v:${companyId}:${scope}`;

export interface CacheRequest {
  companyId: string;
  /** Scopes the result depends on; bumping any of them invalidates it. */
  scopes: readonly AnalyticsScope[];
  /** Endpoint + parameters that make the result unique. */
  key: Record<string, unknown>;
  ttlMs: number;
}

/**
 * Read-through cache for analytics in Redis.
 *
 * - Keys embed a version per (company, scope); an event only `INCR`s the
 *   version (O(1)), so stale entries are never read again and simply expire.
 * - Single-flight: the first request computes under a short `SET NX` lock,
 *   concurrent ones wait for its result instead of hitting the database.
 * - Fail-open: any Redis error just computes directly.
 */
@Injectable()
export class AnalyticsCacheService {
  constructor(
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AnalyticsCacheService.name);
  }

  async wrap<T>(request: CacheRequest, compute: () => Promise<T>): Promise<T> {
    let dataKey: string;
    try {
      dataKey = await this.dataKey(request);
      const hit = await this.redis.get(dataKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.warn(error);
      return compute();
    }

    const lockKey = `${dataKey}:lock`;
    const leader = await this.redis
      .set(lockKey, '1', 'PX', LOCK_MS, 'NX')
      .then((result) => result === 'OK')
      .catch(() => true);

    if (!leader) {
      for (let attempt = 0; attempt < FOLLOW_ATTEMPTS; attempt++) {
        await delay(FOLLOW_DELAY_MS);
        const hit = await this.redis.get(dataKey).catch(() => null);
        if (hit !== null) return JSON.parse(hit) as T;
      }
    }

    try {
      const value = await compute();
      await this.redis
        .set(dataKey, JSON.stringify(value), 'PX', request.ttlMs)
        .catch((error: unknown) => this.warn(error));
      return value;
    } finally {
      if (leader) await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /** Invalidates every cached result of the company that depends on `scopes`. */
  async bump(companyId: string, scopes: readonly AnalyticsScope[]): Promise<void> {
    try {
      await Promise.all(scopes.map((scope) => this.redis.incr(versionKey(companyId, scope))));
    } catch (error) {
      this.warn(error);
    }
  }

  private async dataKey(request: CacheRequest): Promise<string> {
    const scopes = [...new Set(request.scopes)].sort();
    const versions = scopes.length
      ? await this.redis.mget(...scopes.map((scope) => versionKey(request.companyId, scope)))
      : [];
    const hash = createHash('sha1')
      .update(JSON.stringify(sortKeys(request.key)))
      .digest('hex')
      .slice(0, 16);
    const stamp = scopes.map((scope, i) => `${scope}${versions[i] ?? 0}`).join('.');
    return `analytics:d:${request.companyId}:${stamp}:${hash}`;
  }

  private warn(error: unknown): void {
    this.logger.warn({ error: String(error) }, 'Analytics cache unavailable; computing directly');
  }
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
