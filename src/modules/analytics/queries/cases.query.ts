// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

import type { CaseStatus, ChannelFilter, ChannelType } from '@contracts';
import { CaseReply } from '../../cases/entities/case-reply.entity';
import { Case } from '../../cases/entities/case.entity';
import type { CaseRow, ReplyRow, TimeRange } from '../analytics.types';
import { at, toBool, toMillis, toNumber, toStringOrNull, whereChannel } from './raw-values';

type RawCase = Record<string, unknown>;

/**
 * Case-level reads. Every query is scoped by company, skips soft-deleted
 * conversations and returns plain rows; statistics happen in calculators.
 */
@Injectable()
export class CasesQuery {
  constructor(private readonly dataSource: DataSource) {}

  private base(companyId: string, channel: ChannelFilter): SelectQueryBuilder<Case> {
    const query = this.dataSource
      .getRepository(Case)
      .createQueryBuilder('c')
      .innerJoin('c.conversation', 'conv', 'conv.deleted_at IS NULL')
      .leftJoin('conv.customer', 'customer')
      .select([
        'c.id AS id',
        'c.conversation_id AS conversationId',
        'c.customer_id AS customerId',
        'customer.display_name AS customerName',
        'c.channel_type AS channelType',
        'c.status AS status',
        'c.opened_at AS openedAt',
        'c.first_response_at AS firstResponseAt',
        'c.first_responder_member_id AS firstResponderMemberId',
        'c.awaiting_reply_since AS awaitingReplySince',
        'c.closed_at AS closedAt',
        'c.owner_member_id AS ownerMemberId',
        'c.reopen_of_case_id AS reopenOfCaseId',
        'c.inbound_count AS inboundCount',
        'c.outbound_count AS outboundCount',
        'conv.assigned_member_id AS assignedMemberId',
      ])
      .where('c.company_id = :companyId', { companyId });

    return whereChannel(query, 'c.channel_type', channel);
  }

  /** Cases opened or closed inside the range. */
  async touchedIn(companyId: string, range: TimeRange, channel: ChannelFilter): Promise<CaseRow[]> {
    const rows = await this.base(companyId, channel)
      .andWhere(
        '((c.opened_at >= :from AND c.opened_at < :to) OR (c.closed_at >= :from AND c.closed_at < :to))',
        { from: at(range.from), to: at(range.to) },
      )
      .getRawMany<RawCase>();
    return rows.map(toCaseRow);
  }

  /** Cases still open right now. */
  async open(companyId: string, channel: ChannelFilter): Promise<CaseRow[]> {
    const rows = await this.base(companyId, channel)
      .andWhere('c.status = :status', { status: 'open' })
      .getRawMany<RawCase>();
    return rows.map(toCaseRow);
  }

  /** Cases opened since `since` (arrivals, staffing history). */
  async openedSince(companyId: string, since: number, channel: ChannelFilter): Promise<CaseRow[]> {
    const rows = await this.base(companyId, channel)
      .andWhere('c.opened_at >= :since', { since: at(since) })
      .getRawMany<RawCase>();
    return rows.map(toCaseRow);
  }

  /** Cases closed since `since` (handle time for staffing). */
  async closedSince(companyId: string, since: number, channel: ChannelFilter): Promise<CaseRow[]> {
    const rows = await this.base(companyId, channel)
      .andWhere('c.closed_at >= :since', { since: at(since) })
      .getRawMany<RawCase>();
    return rows.map(toCaseRow);
  }

  /** Open cases at an instant (backlog before a range). */
  async openAt(companyId: string, instant: number, channel: ChannelFilter): Promise<number> {
    const query = this.dataSource
      .getRepository(Case)
      .createQueryBuilder('c')
      .innerJoin('c.conversation', 'conv', 'conv.deleted_at IS NULL')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('c.opened_at < :instant', { instant: at(instant) })
      .andWhere('(c.closed_at IS NULL OR c.closed_at >= :instant)', { instant: at(instant) });
    return whereChannel(query, 'c.channel_type', channel).getCount();
  }

  /** Ids of cases that were reopened (a later case points at them). */
  async reopenedIds(companyId: string, since: number): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(Case)
      .createQueryBuilder('c')
      .select('c.reopen_of_case_id', 'reopenOf')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('c.reopen_of_case_id IS NOT NULL')
      .andWhere('c.opened_at >= :since', { since: at(since) })
      .getRawMany<{ reopenOf: unknown }>();
    return new Set(rows.map((row) => String(row.reopenOf)));
  }

  /** First-ever case per customer among the given ones (new vs returning). */
  async firstCaseAt(companyId: string, customerIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (let i = 0; i < customerIds.length; i += 500) {
      const chunk = customerIds.slice(i, i + 500);
      const rows = await this.dataSource
        .getRepository(Case)
        .createQueryBuilder('c')
        .select('c.customer_id', 'customerId')
        .addSelect('MIN(c.opened_at)', 'firstAt')
        .where('c.company_id = :companyId', { companyId })
        .andWhere('c.customer_id IN (:...chunk)', { chunk })
        .groupBy('c.customer_id')
        .getRawMany<{ customerId: unknown; firstAt: unknown }>();
      for (const row of rows) {
        const first = toMillis(row.firstAt);
        if (first !== null) result.set(String(row.customerId), first);
      }
    }
    return result;
  }

  /** Distinct local-day count with activity is computed by callers. */
  async openedTimestamps(companyId: string, since: number): Promise<number[]> {
    const rows = await this.dataSource
      .getRepository(Case)
      .createQueryBuilder('c')
      .select('c.opened_at', 'openedAt')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('c.opened_at >= :since', { since: at(since) })
      .getRawMany<{ openedAt: unknown }>();
    return rows.map((row) => toMillis(row.openedAt)).filter((v): v is number => v !== null);
  }

  /** Answered customer bursts inside the range. */
  async repliesIn(companyId: string, range: TimeRange, channel: ChannelFilter): Promise<ReplyRow[]> {
    const query = this.dataSource
      .getRepository(CaseReply)
      .createQueryBuilder('r')
      .innerJoin('r.case', 'c')
      .select([
        'r.member_id AS memberId',
        'r.awaited_from AS awaitedFrom',
        'r.replied_at AS repliedAt',
        'r.is_first AS isFirst',
      ])
      .where('r.company_id = :companyId', { companyId })
      .andWhere('r.replied_at >= :from AND r.replied_at < :to', {
        from: at(range.from),
        to: at(range.to),
      });

    const rows = await whereChannel(query, 'c.channel_type', channel).getRawMany<Record<string, unknown>>();
    return rows.flatMap((row) => {
      const awaitedFrom = toMillis(row.awaitedFrom);
      const repliedAt = toMillis(row.repliedAt);
      if (awaitedFrom === null || repliedAt === null) return [];
      return [
        {
          memberId: toStringOrNull(row.memberId),
          awaitedFrom,
          repliedAt,
          isFirst: toBool(row.isFirst),
        },
      ];
    });
  }
}

function toCaseRow(row: RawCase): CaseRow {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    customerId: String(row.customerId),
    customerName: toStringOrNull(row.customerName),
    channelType: row.channelType as ChannelType,
    status: row.status as CaseStatus,
    openedAt: toMillis(row.openedAt) ?? 0,
    firstResponseAt: toMillis(row.firstResponseAt),
    firstResponderMemberId: toStringOrNull(row.firstResponderMemberId),
    awaitingReplySince: toMillis(row.awaitingReplySince),
    closedAt: toMillis(row.closedAt),
    ownerMemberId: toStringOrNull(row.ownerMemberId),
    reopenOfCaseId: toStringOrNull(row.reopenOfCaseId),
    inboundCount: toNumber(row.inboundCount),
    outboundCount: toNumber(row.outboundCount),
    assignedMemberId: toStringOrNull(row.assignedMemberId),
  };
}
