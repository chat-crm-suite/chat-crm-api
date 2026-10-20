// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { In, IsNull, Repository } from 'typeorm';

import { NotificationDeliveredEvent } from '../../common/events/notification-realtime.event';
import { APP_REDIS, type AppRedis } from '../../common/redis/app-redis.module';
import { NOTIFICATION_AUDIENCE, type MemberRole } from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Notification } from './entities/notification.entity';
import { readPreferences, toNotificationItem } from './notification.mapper';
import { NotificationUnreadCounter } from './notification-unread.counter';
import {
  DEFAULT_DEDUPE_TTL_MS,
  DEFAULT_SEVERITY,
  type NotifyInput,
} from './notification.types';

export const dedupeKey = (memberId: string, input: Pick<NotifyInput, 'type' | 'dedupeKey'>) =>
  `notif:dedupe:${memberId}:${createHash('sha1').update(`${input.type}|${input.dedupeKey}`).digest('hex')}`;

type Recipient = Pick<CompanyMember, 'id' | 'userId' | 'role' | 'notificationPrefs'>;

/** What happened for one recipient (tests and logs). */
export type DeliveryOutcome = 'new' | 'updated' | 'muted' | 'duplicate';

/**
 * Worker side of the dispatcher. Per recipient: muted? → duplicate? (Redis
 * `SET NX`) → collapse into the unread row of the same group or insert →
 * recount the badge → relay to `user:{id}` through the CQRS bus. MySQL keeps
 * the history; Redis only guards against repeats and caches the badge, and
 * its outage degrades to "no dedupe window" instead of failing the job.
 */
@Injectable()
export class NotificationDeliveryService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(CompanyMember)
    private readonly memberRepo: Repository<CompanyMember>,
    private readonly unread: NotificationUnreadCounter,
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(NotificationDeliveryService.name);
  }

  async deliver(input: NotifyInput): Promise<Map<string, DeliveryOutcome>> {
    const outcomes = new Map<string, DeliveryOutcome>();

    for (const recipient of await this.resolveRecipients(input)) {
      outcomes.set(recipient.id, await this.deliverTo(recipient, input));
    }

    return outcomes;
  }

  /**
   * Active members of the company, narrowed by the event audience and capped
   * by the roles allowed for the type, minus the actor.
   */
  async resolveRecipients(input: NotifyInput): Promise<Recipient[]> {
    const allowed: readonly MemberRole[] = NOTIFICATION_AUDIENCE[input.type];
    const roles =
      'roles' in input.audience
        ? input.audience.roles.filter((role) => allowed.includes(role))
        : [...allowed];
    if (!roles.length) return [];

    const memberIds = 'memberIds' in input.audience ? input.audience.memberIds : null;
    if (memberIds && !memberIds.length) return [];

    const members = await this.memberRepo.find({
      where: {
        companyId: input.companyId,
        status: 'active',
        role: In(roles),
        ...(memberIds ? { id: In(memberIds) } : {}),
      },
      select: { id: true, userId: true, role: true, notificationPrefs: true },
    });

    const excluded = new Set(input.excludeMemberIds ?? []);
    return members.filter((member) => !excluded.has(member.id));
  }

  private async deliverTo(recipient: Recipient, input: NotifyInput): Promise<DeliveryOutcome> {
    if (readPreferences(recipient.notificationPrefs).muted.includes(input.type)) {
      return 'muted';
    }

    const key = dedupeKey(recipient.id, input);
    if (!(await this.claimDedupe(key, input.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS))) {
      return 'duplicate';
    }

    try {
      const { row, kind } = await this.store(recipient.id, input);
      const unreadCount = await this.unread.refresh(recipient.id);

      this.eventBus?.publish(
        new NotificationDeliveredEvent(recipient.userId, kind, {
          notification: toNotificationItem(row),
          unreadCount,
        }),
      );

      return kind;
    } catch (error) {
      // Let the retry deliver it: the dedupe mark must not outlive a failure.
      await this.releaseDedupe(key);
      throw error;
    }
  }

  private async store(
    memberId: string,
    input: NotifyInput,
  ): Promise<{ row: Notification; kind: 'new' | 'updated' }> {
    const fields = {
      title: input.title,
      body: input.body ?? null,
      data: { ...(input.data ?? {}) },
      severity: input.severity ?? DEFAULT_SEVERITY[input.type],
    };

    if (input.groupKey) {
      const open = await this.notificationRepo.findOne({
        where: { recipientMemberId: memberId, groupKey: input.groupKey, readAt: IsNull() },
        order: { updatedAt: 'DESC' },
      });

      if (open) {
        await this.notificationRepo
          .createQueryBuilder()
          .update(Notification)
          // Explicit millisecond stamp: the implicit CURRENT_TIMESTAMP has
          // second precision and would sort the grown row behind newer ones.
          .set({ ...fields, count: () => 'count + 1', updatedAt: new Date() })
          .where('id = :id', { id: open.id })
          .execute();

        const row = await this.notificationRepo.findOneByOrFail({ id: open.id });
        return { row, kind: 'updated' };
      }
    }

    const row = await this.notificationRepo.save(
      this.notificationRepo.create({
        ...fields,
        companyId: input.companyId,
        recipientMemberId: memberId,
        type: input.type,
        groupKey: input.groupKey ?? null,
        count: 1,
        updatedAt: new Date(),
      }),
    );

    return { row, kind: 'new' };
  }

  /** `true` = first time; Redis down = treat as first (fail open). */
  private async claimDedupe(key: string, ttlMs: number): Promise<boolean> {
    try {
      return (await this.redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Notification dedupe unavailable');
      return true;
    }
  }

  private async releaseDedupe(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Redis down: the key expires on its own.
    }
  }
}
