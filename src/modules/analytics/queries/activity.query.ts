// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  ChannelFilter,
  ChannelType,
  MemberRole,
  SentimentLabel,
} from '@contracts';
import { Analysis } from '../../analysis/entities/analysis.entity';
import { Case } from '../../cases/entities/case.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { ConversationAssignment } from '../../conversations/entities/conversation-assignment.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../message/entities/message.entity';
import { PresenceInterval } from '../../presence/entities/presence-interval.entity';
import type {
  MemberRow,
  PresenceRow,
  TimeRange,
  ToneRow,
  TransferRow,
} from '../analytics.types';
import { at, toMillis, toNumber, toStringOrNull, whereChannel } from './raw-values';

export interface MessageCountRow {
  at: number;
  direction: 'inbound' | 'outbound';
}

export interface DeliveryCountRow {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  count: number;
}

/**
 * Reads around cases: members, presence, transfers, messages, delivery and
 * tone. Company-scoped, soft-delete aware, portable SQL only.
 */
@Injectable()
export class ActivityQuery {
  constructor(private readonly dataSource: DataSource) {}

  /** Active members with their display name and capacity override. */
  async members(companyId: string): Promise<MemberRow[]> {
    const rows = await this.dataSource
      .getRepository(CompanyMember)
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u', 'u.deleted_at IS NULL')
      .select([
        'm.id AS memberId',
        'm.user_id AS userId',
        'm.role AS role',
        'm.max_open_conversations AS capacity',
        'u.username AS username',
        'u.first_name AS firstName',
        'u.last_name AS lastName',
      ])
      .where('m.company_id = :companyId', { companyId })
      .andWhere('m.status = :status', { status: 'active' })
      .getRawMany<Record<string, unknown>>();

    return rows
      .map((row) => {
        const fullName = [row.firstName, row.lastName]
          .filter((part) => typeof part === 'string' && part.trim())
          .join(' ');
        const capacity = row.capacity === null || row.capacity === undefined ? null : toNumber(row.capacity);
        return {
          memberId: String(row.memberId),
          userId: String(row.userId),
          role: row.role as MemberRole,
          displayName: fullName || String(row.username),
          capacity: capacity !== null && capacity > 0 ? capacity : null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Presence intervals overlapping the range. */
  async presence(companyId: string, range: TimeRange): Promise<PresenceRow[]> {
    const rows = await this.dataSource
      .getRepository(PresenceInterval)
      .createQueryBuilder('p')
      .select([
        'p.member_id AS memberId',
        'p.state AS state',
        'p.started_at AS startedAt',
        'p.ended_at AS endedAt',
      ])
      .where('p.company_id = :companyId', { companyId })
      .andWhere('p.started_at < :to', { to: at(range.to) })
      .andWhere('(p.ended_at IS NULL OR p.ended_at > :from)', { from: at(range.from) })
      .getRawMany<Record<string, unknown>>();

    return rows.flatMap((row) => {
      const startedAt = toMillis(row.startedAt);
      if (startedAt === null) return [];
      return [
        {
          memberId: String(row.memberId),
          state: row.state === 'away' ? ('away' as const) : ('available' as const),
          startedAt,
          endedAt: toMillis(row.endedAt),
        },
      ];
    });
  }

  /**
   * Transfers inside the range with their "from" member: the assignment row
   * of the same conversation right before each transfer.
   */
  async transfers(companyId: string, range: TimeRange): Promise<TransferRow[]> {
    const transferRows = await this.dataSource
      .getRepository(ConversationAssignment)
      .createQueryBuilder('a')
      .innerJoin(Conversation, 'conv', 'conv.id = a.conversation_id AND conv.deleted_at IS NULL')
      .select('DISTINCT a.conversation_id', 'conversationId')
      .where('conv.company_id = :companyId', { companyId })
      .andWhere('a.reason = :reason', { reason: 'transfer' })
      .andWhere('a.assigned_at >= :from AND a.assigned_at < :to', {
        from: at(range.from),
        to: at(range.to),
      })
      .getRawMany<{ conversationId: unknown }>();

    const conversationIds = transferRows.map((row) => String(row.conversationId));
    if (!conversationIds.length) return [];

    const history = await this.dataSource
      .getRepository(ConversationAssignment)
      .createQueryBuilder('a')
      .select([
        'a.conversation_id AS conversationId',
        'a.member_id AS memberId',
        'a.reason AS reason',
        'a.assigned_at AS assignedAt',
      ])
      .where('a.conversation_id IN (:...conversationIds)', { conversationIds })
      .andWhere('a.assigned_at < :to', { to: at(range.to) })
      .getRawMany<Record<string, unknown>>();

    const byConversation = new Map<string, { memberId: string; reason: string; at: number }[]>();
    for (const row of history) {
      const assignedAt = toMillis(row.assignedAt);
      if (assignedAt === null) continue;
      const list = byConversation.get(String(row.conversationId)) ?? [];
      list.push({ memberId: String(row.memberId), reason: String(row.reason), at: assignedAt });
      byConversation.set(String(row.conversationId), list);
    }

    const result: TransferRow[] = [];
    for (const list of byConversation.values()) {
      list.sort((a, b) => a.at - b.at);
      list.forEach((entry, index) => {
        if (entry.reason !== 'transfer' || index === 0) return;
        if (entry.at < range.from || entry.at >= range.to) return;
        result.push({ fromMemberId: list[index - 1].memberId, toMemberId: entry.memberId, at: entry.at });
      });
    }
    return result;
  }

  /** Message timestamps by direction inside the range (volume per day). */
  async messages(companyId: string, range: TimeRange, channel: ChannelFilter): Promise<MessageCountRow[]> {
    const query = this.dataSource
      .getRepository(Message)
      .createQueryBuilder('msg')
      .innerJoin('msg.conversation', 'conv', 'conv.deleted_at IS NULL')
      .innerJoin('conv.channel', 'ch')
      .select(['msg.created_at AS createdAt', 'msg.direction AS direction'])
      .where('msg.company_id = :companyId', { companyId })
      .andWhere('msg.deleted_at IS NULL')
      .andWhere('msg.created_at >= :from AND msg.created_at < :to', {
        from: at(range.from),
        to: at(range.to),
      });

    const rows = await whereChannel(query, 'ch.type', channel).getRawMany<Record<string, unknown>>();
    return rows.flatMap((row) => {
      const createdAt = toMillis(row.createdAt);
      if (createdAt === null) return [];
      return [{ at: createdAt, direction: row.direction === 'inbound' ? 'inbound' : 'outbound' }];
    });
  }

  /** Outbound message counts by final status and error code. */
  async delivery(companyId: string, range: TimeRange, channel: ChannelFilter): Promise<DeliveryCountRow[]> {
    const query = this.dataSource
      .getRepository(Message)
      .createQueryBuilder('msg')
      .innerJoin('msg.conversation', 'conv', 'conv.deleted_at IS NULL')
      .innerJoin('conv.channel', 'ch')
      .select('msg.status', 'status')
      .addSelect('msg.error_code', 'errorCode')
      .addSelect('MAX(msg.error_message)', 'errorMessage')
      .addSelect('COUNT(*)', 'count')
      .where('msg.company_id = :companyId', { companyId })
      .andWhere('msg.deleted_at IS NULL')
      .andWhere('msg.direction = :direction', { direction: 'outbound' })
      .andWhere('msg.created_at >= :from AND msg.created_at < :to', {
        from: at(range.from),
        to: at(range.to),
      })
      .groupBy('msg.status')
      .addGroupBy('msg.error_code');

    const rows = await whereChannel(query, 'ch.type', channel).getRawMany<Record<string, unknown>>();
    return rows.map((row) => ({
      status: String(row.status),
      errorCode: toStringOrNull(row.errorCode),
      errorMessage: toStringOrNull(row.errorMessage),
      count: toNumber(row.count),
    }));
  }

  /**
   * Customer tone: completed sentiment analyses of inbound messages in the
   * range, with the owner of the case each message belongs to.
   */
  async tone(companyId: string, range: TimeRange, channel: ChannelFilter): Promise<ToneRow[]> {
    const query = this.dataSource
      .getRepository(Analysis)
      .createQueryBuilder('a')
      .innerJoin('sentiment_results', 'sr', 'sr.analysis_id = a.id')
      .innerJoin(Message, 'msg', 'msg.id = a.message_id AND msg.deleted_at IS NULL')
      .innerJoin(Conversation, 'conv', 'conv.id = msg.conversation_id AND conv.deleted_at IS NULL')
      .innerJoin(Channel, 'ch', 'ch.id = conv.channel_id')
      .leftJoin(
        Case,
        'c',
        'c.conversation_id = msg.conversation_id AND c.opened_at <= msg.created_at AND (c.closed_at IS NULL OR c.closed_at >= msg.created_at)',
      )
      .select([
        'msg.created_at AS createdAt',
        'sr.label AS label',
        'c.owner_member_id AS ownerMemberId',
        'c.status AS caseStatus',
        'conv.assigned_member_id AS assignedMemberId',
      ])
      .where('a.company_id = :companyId', { companyId })
      .andWhere('a.type = :type', { type: 'sentiment' })
      .andWhere('a.status = :status', { status: 'completed' })
      .andWhere('msg.direction = :direction', { direction: 'inbound' })
      .andWhere('msg.created_at >= :from AND msg.created_at < :to', {
        from: at(range.from),
        to: at(range.to),
      });

    const rows = await whereChannel(query, 'ch.type', channel).getRawMany<Record<string, unknown>>();
    return rows.flatMap((row) => {
      const createdAt = toMillis(row.createdAt);
      const label = normalizeLabel(row.label);
      if (createdAt === null || !label) return [];
      const owner =
        toStringOrNull(row.ownerMemberId) ??
        (row.caseStatus === 'open' ? toStringOrNull(row.assignedMemberId) : null);
      return [{ at: createdAt, label, ownerMemberId: owner }];
    });
  }

  /** Channels of the company (readiness) and whether any inbound exists. */
  async channels(companyId: string): Promise<{ type: ChannelType; status: string }[]> {
    const rows = await this.dataSource
      .getRepository(Channel)
      .createQueryBuilder('ch')
      .select(['ch.type AS type', 'ch.status AS status'])
      .where('ch.company_id = :companyId', { companyId })
      .andWhere('ch.deleted_at IS NULL')
      .getRawMany<{ type: ChannelType; status: unknown }>();
    return rows.map((row) => ({ type: row.type, status: String(row.status) }));
  }

  async hasInbound(companyId: string): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(Message)
      .createQueryBuilder('msg')
      .where('msg.company_id = :companyId', { companyId })
      .andWhere('msg.direction = :direction', { direction: 'inbound' })
      .andWhere('msg.deleted_at IS NULL')
      .limit(1)
      .getCount();
    return count > 0;
  }
}

/** Stored labels are long (`positive`); older rows may carry `POS`. */
function normalizeLabel(value: unknown): SentimentLabel | null {
  const label = typeof value === 'string' ? value.toLowerCase() : '';
  if (label.startsWith('pos')) return 'positive';
  if (label.startsWith('neg')) return 'negative';
  if (label.startsWith('neu')) return 'neutral';
  return null;
}
