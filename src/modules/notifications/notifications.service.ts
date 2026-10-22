// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { NotificationsReadEvent } from '../../common/events/notification-realtime.event';
import {
  conversationGroupKey,
  type NotificationListQuery,
  NotificationListResponse,
  type NotificationMarkRead,
  type NotificationPreferences,
} from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Notification } from './entities/notification.entity';
import { readPreferences, toNotificationItem } from './notification.mapper';
import { NotificationUnreadCounter } from './notification-unread.counter';

/** Who is reading: the member of the active company and its user (socket room). */
export interface NotificationReader {
  memberId: string;
  userId: string;
  companyId: string;
}

/**
 * Read side of the bell: list (keyset on `updatedAt, id`), badge, read state
 * and preferences. Writes go through `NotificationDispatcher`.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(CompanyMember)
    private readonly memberRepo: Repository<CompanyMember>,
    private readonly unread: NotificationUnreadCounter,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  /**
   * Latest activity first. `before` pages older rows; `after` returns what
   * changed since a row (new rows and grouped rows that grew), which is what
   * a reconnecting client needs.
   */
  async list(
    reader: NotificationReader,
    query: NotificationListQuery,
  ): Promise<NotificationListResponse> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.recipient_member_id = :memberId', { memberId: reader.memberId })
      .andWhere('n.company_id = :companyId', { companyId: reader.companyId })
      .orderBy('n.updated_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(query.limit + 1);

    const cursorId = query.before ?? query.after;
    if (cursorId) {
      // Raw column value, so the comparison uses the driver's own format.
      const cursor = await this.notificationRepo
        .createQueryBuilder('c')
        .select('c.updated_at', 'at')
        .where('c.id = :cursorId', { cursorId })
        .andWhere('c.recipient_member_id = :memberId', { memberId: reader.memberId })
        .getRawOne<{ at: unknown }>();

      if (cursor) {
        const op = query.before ? '<' : '>';
        qb.andWhere(
          `(n.updated_at ${op} :at OR (n.updated_at = :at AND n.id ${op} :cursorId))`,
          { at: cursor.at, cursorId },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);

    return {
      items: items.map(toNotificationItem),
      unreadCount: await this.unread.get(reader.memberId),
      nextCursor: hasMore && !query.after ? items[items.length - 1].id : null,
    };
  }

  unreadCount(memberId: string): Promise<number> {
    return this.unread.get(memberId);
  }

  async markRead(reader: NotificationReader, id: string): Promise<{ unreadCount: number }> {
    const exists = await this.notificationRepo.exist({
      where: { id, recipientMemberId: reader.memberId },
    });
    if (!exists) throw new NotFoundException('Notification not found');

    await this.notificationRepo.update(
      { id, recipientMemberId: reader.memberId, readAt: IsNull() },
      { readAt: new Date() },
    );

    return this.afterRead(reader, [id]);
  }

  /**
   * Everything unread, or only what is about one conversation (opening a
   * chat reads its assignment and message notices).
   */
  async markAllRead(
    reader: NotificationReader,
    scope: NotificationMarkRead = {},
  ): Promise<{ unreadCount: number }> {
    const unread = {
      recipientMemberId: reader.memberId,
      companyId: reader.companyId,
      readAt: IsNull(),
    };

    if (!scope.conversationId) {
      await this.notificationRepo.update(unread, { readAt: new Date() });
      return this.afterRead(reader, 'all');
    }

    const rows = await this.notificationRepo.find({
      where: { ...unread, groupKey: conversationGroupKey(scope.conversationId) },
      select: { id: true },
    });
    // Nothing to read: no recount, no echo (opening chats is frequent).
    if (!rows.length) return { unreadCount: await this.unread.get(reader.memberId) };

    const ids = rows.map((row) => row.id);
    await this.notificationRepo.update({ id: In(ids) }, { readAt: new Date() });
    return this.afterRead(reader, ids);
  }

  /** Preferences of a member; nothing muted until they choose. */
  async getPreferences(memberId: string): Promise<NotificationPreferences> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      select: { id: true, notificationPrefs: true },
    });

    return readPreferences(member?.notificationPrefs);
  }

  async setPreferences(
    memberId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const next: NotificationPreferences = {
      muted: [...new Set(preferences.muted)],
      desktop: [...new Set(preferences.desktop)],
    };
    await this.memberRepo.update(memberId, { notificationPrefs: next });

    return next;
  }

  /** Recount once and tell every other tab/device of the reader. */
  private async afterRead(
    reader: NotificationReader,
    ids: string[] | 'all',
  ): Promise<{ unreadCount: number }> {
    const unreadCount = await this.unread.refresh(reader.memberId);

    this.eventBus?.publish(
      new NotificationsReadEvent(reader.userId, {
        companyId: reader.companyId,
        ids,
        unreadCount,
      }),
    );

    return { unreadCount };
  }
}
