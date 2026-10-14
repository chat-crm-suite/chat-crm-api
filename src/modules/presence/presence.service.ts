// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { In, IsNull, Repository } from 'typeorm';

import { APP_REDIS, type AppRedis } from '../../common/redis/app-redis.module';
import type { ManualPresenceState, Presence } from '../../contracts/index';
import { PresenceChangedEvent } from '../analytics/events/analytics.events';
import { PresenceInterval } from './entities/presence-interval.entity';

/** Redis key of a member's chosen state; survives reconnects. */
export const presencePreferenceKey = (memberId: string) =>
  `presence:pref:${memberId}`;

/**
 * Agent presence. A member is online while the gateway holds at least one of
 * their sockets; online time is recorded as `presence_intervals` in the
 * member's chosen state (`available` by default, `away` on request). No open
 * interval means offline.
 *
 * The database is the source of truth; Redis only remembers the manual
 * preference across reconnects and fails open to `available`.
 */
@Injectable()
export class PresenceService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(PresenceInterval)
    private readonly intervals: Repository<PresenceInterval>,
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(PresenceService.name);
  }

  /**
   * Intervals left open by a crash cannot be trusted: sockets reconnect after
   * a restart and open fresh ones.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.intervals.update({ endedAt: IsNull() }, { endedAt: new Date() });
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Could not close stale presence');
    }
  }

  /** First socket of the member came up: start an interval if none is open. */
  async connected(companyId: string, memberId: string): Promise<void> {
    const open = await this.findOpen(memberId);
    if (open) return;

    const state = await this.preference(memberId);
    const started = await this.start(companyId, memberId, state);
    this.publish(companyId, { memberId, state, since: started.startedAt });
  }

  /** Last socket of the member went away: close the open interval. */
  async disconnected(companyId: string, memberId: string): Promise<void> {
    const now = new Date();
    const result = await this.intervals.update(
      { memberId, endedAt: IsNull() },
      { endedAt: now },
    );
    if (result.affected) {
      this.publish(companyId, { memberId, state: 'offline', since: now });
    }
  }

  /** Manual availability; calling it means the member is online. */
  async setState(
    companyId: string,
    memberId: string,
    state: ManualPresenceState,
  ): Promise<Presence> {
    try {
      await this.redis.set(presencePreferenceKey(memberId), state);
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Presence preference not stored');
    }

    const open = await this.findOpen(memberId);
    if (open?.state === state) {
      return { memberId, state, since: open.startedAt };
    }

    const now = new Date();
    if (open) {
      await this.intervals.update({ id: open.id }, { endedAt: now });
    }
    const started = await this.start(companyId, memberId, state, now);
    const presence = { memberId, state, since: started.startedAt };
    this.publish(companyId, presence);

    return presence;
  }

  /** Current presence of one member. */
  async get(memberId: string): Promise<Presence> {
    const open = await this.findOpen(memberId);
    if (!open) return { memberId, state: 'offline', since: new Date() };

    return { memberId, state: open.state, since: open.startedAt };
  }

  /** Current presence of many members (missing = offline, `since` null). */
  async current(
    companyId: string,
    memberIds: string[],
  ): Promise<Map<string, { state: Presence['state']; since: Date | null }>> {
    const result = new Map<string, { state: Presence['state']; since: Date | null }>();
    for (const memberId of memberIds) {
      result.set(memberId, { state: 'offline', since: null });
    }
    if (!memberIds.length) return result;

    const open = await this.intervals.find({
      where: { companyId, memberId: In(memberIds), endedAt: IsNull() },
    });
    for (const interval of open) {
      result.set(interval.memberId, {
        state: interval.state,
        since: interval.startedAt,
      });
    }

    return result;
  }

  private findOpen(memberId: string): Promise<PresenceInterval | null> {
    return this.intervals.findOne({ where: { memberId, endedAt: IsNull() } });
  }

  private start(
    companyId: string,
    memberId: string,
    state: ManualPresenceState,
    at = new Date(),
  ): Promise<PresenceInterval> {
    return this.intervals.save(
      this.intervals.create({ companyId, memberId, state, startedAt: at }),
    );
  }

  private async preference(memberId: string): Promise<ManualPresenceState> {
    try {
      const stored = await this.redis.get(presencePreferenceKey(memberId));
      return stored === 'away' ? 'away' : 'available';
    } catch {
      return 'available';
    }
  }

  private publish(companyId: string, presence: Presence): void {
    this.eventBus?.publish(new PresenceChangedEvent(companyId, presence));
  }
}
