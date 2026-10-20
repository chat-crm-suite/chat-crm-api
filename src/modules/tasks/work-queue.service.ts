// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException, Injectable } from '@nestjs/common';
import { Brackets, DataSource, In, IsNull, SelectQueryBuilder } from 'typeorm';

import {
  CHANNEL_CAPABILITIES,
  WINDOW_EXPIRING_MS,
  type ChannelType,
  type TaskMemberRef,
  type WorkQueueCounts,
  type WorkQueueQuery,
  type WorkQueueResponse,
  type WorkSignal,
} from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { memberDisplayName } from '../company-members/member-name';
import { ConversationAssignmentService } from '../conversations/assignment/conversation-assignment.service';
import { ConversationAssignment } from '../conversations/entities/conversation-assignment.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { replyWindowExpiresAt } from '../conversations/listing/conversation-list.service';
import { TasksService, type TaskActor } from './tasks.service';
import { WorkQueueCache } from './work-queue.cache';

/** Same default threshold as `GET /conversations/needs-response`. */
export const NEEDS_RESPONSE_MINUTES = 15;
const SIGNAL_LIMIT = 50;
/** Needs-response rows are filtered by owner after the query: read a wider page. */
const NEEDS_RESPONSE_SCAN = 200;
const ACTIVE_STATUSES = ['open', 'pending'];

/**
 * `GET /work-queue`: the caller's open tasks plus live signals derived from
 * conversations (never stored). Lists are computed on every call; the counts
 * (sidebar badge) come from a short-lived Redis cache per company + scope.
 *
 * - agent (`mine`): own tasks, the shared queue, own conversations' signals.
 * - admin/supervisor `scope=all`: everything, or one `assigneeId`.
 */
@Injectable()
export class WorkQueueService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly assignments: ConversationAssignmentService,
    private readonly cache: WorkQueueCache,
  ) {}

  async get(actor: TaskActor, query: WorkQueueQuery): Promise<WorkQueueResponse> {
    const supervisor = actor.role === 'admin' || actor.role === 'supervisor';
    if ((query.scope === 'all' || query.assigneeId) && !supervisor) {
      throw new ForbiddenException('Only admins and supervisors can read the team queue');
    }

    const all = query.scope === 'all';
    // null = the whole company.
    const ownerId = all ? (query.assigneeId ?? null) : actor.memberId;
    const includeQueue = !(all && query.assigneeId);
    const now = new Date();

    const [tasks, unassigned, needsResponse, expiring, counts] = await Promise.all([
      this.tasks.listOpen(actor.companyId, ownerId),
      includeQueue
        ? this.assignments.listUnassigned(actor.companyId, SIGNAL_LIMIT)
        : Promise.resolve([]),
      this.assignments.listNeedsResponse(
        actor.companyId,
        NEEDS_RESPONSE_MINUTES,
        NEEDS_RESPONSE_SCAN,
      ),
      this.windowExpiringQuery(actor.companyId, ownerId, now)
        .select('conversation.id', 'id')
        .orderBy('conversation.last_inbound_at', 'ASC')
        .limit(SIGNAL_LIMIT)
        .getRawMany<{ id: string }>(),
      this.cache.wrap(actor.companyId, `${query.scope}:${ownerId ?? '*'}`, () =>
        this.counts(actor.companyId, ownerId, includeQueue),
      ),
    ]);

    const waiting = needsResponse
      .filter((row) => (ownerId ? row.member?.id === ownerId : true))
      .slice(0, SIGNAL_LIMIT);

    const queued: { id: string; waitingSince: Date }[] = unassigned;
    const ids = [
      ...queued.map((row) => row.id),
      ...waiting.map((row) => row.id),
      ...expiring.map((row) => row.id),
    ];
    const details = await this.signalDetails(ids);

    const signals: WorkSignal[] = [];
    for (const row of queued) {
      const detail = details.get(row.id);
      if (!detail) continue;
      signals.push({
        kind: 'unassigned',
        conversationId: row.id,
        customer: detail.customer,
        channelType: detail.channelType,
        since: row.waitingSince,
        windowExpiresAt: detail.windowExpiresAt,
        assignee: null,
      });
    }
    for (const row of waiting) {
      const detail = details.get(row.id);
      if (!detail) continue;
      signals.push({
        kind: 'needs_response',
        conversationId: row.id,
        customer: detail.customer,
        channelType: detail.channelType,
        // Waiting since the last (inbound) message; the entity keeps it as a Date.
        since: detail.lastMessageAt ?? detail.createdAt,
        windowExpiresAt: detail.windowExpiresAt,
        assignee: detail.assignee,
      });
    }
    for (const row of expiring) {
      const detail = details.get(row.id);
      if (!detail?.lastInboundAt) continue;
      signals.push({
        kind: 'window_expiring',
        conversationId: row.id,
        customer: detail.customer,
        channelType: detail.channelType,
        since: detail.lastInboundAt,
        windowExpiresAt: detail.windowExpiresAt,
        assignee: detail.assignee,
      });
    }

    return { tasks, signals, counts, generatedAt: now };
  }

  /** Badge counts over the whole scope (not capped like the lists). */
  private async counts(
    companyId: string,
    ownerId: string | null,
    includeQueue: boolean,
  ): Promise<WorkQueueCounts> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - NEEDS_RESPONSE_MINUTES * 60_000);

    const [tasks, unassigned, needsResponse, windowExpiring] = await Promise.all([
      this.tasks.countOpen(companyId, ownerId),
      includeQueue
        ? this.activeConversations(companyId)
            .andWhere(
              (qb) =>
                `NOT EXISTS ${qb
                  .subQuery()
                  .select('1')
                  .from(ConversationAssignment, 'queue_ca')
                  .where('queue_ca.conversation_id = conversation.id')
                  .andWhere('queue_ca.unassigned_at IS NULL')
                  .getQuery()}`,
            )
            .getCount()
        : 0,
      this.owned(this.activeConversations(companyId), ownerId)
        .innerJoin('conversation.lastMessage', 'lastMessage')
        .andWhere('lastMessage.direction = :inbound', { inbound: 'inbound' })
        .andWhere('conversation.last_message_at < :cutoff', { cutoff })
        .getCount(),
      this.windowExpiringQuery(companyId, ownerId, now).getCount(),
    ]);

    return { ...tasks, unassigned, needsResponse, windowExpiring };
  }

  private activeConversations(companyId: string): SelectQueryBuilder<Conversation> {
    return this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .where('conversation.company_id = :companyId', { companyId })
      .andWhere('conversation.status IN (:...active)', { active: ACTIVE_STATUSES });
  }

  /** Narrow to conversations whose active owner is `ownerId` (null = no filter). */
  private owned(
    qb: SelectQueryBuilder<Conversation>,
    ownerId: string | null,
  ): SelectQueryBuilder<Conversation> {
    if (!ownerId) return qb;
    return qb
      .innerJoin(
        ConversationAssignment,
        'owner_ca',
        'owner_ca.conversation_id = conversation.id AND owner_ca.unassigned_at IS NULL',
      )
      .andWhere('owner_ca.member_id = :ownerId', { ownerId });
  }

  /**
   * Open/pending conversations whose reply window closes within
   * `WINDOW_EXPIRING_MS` (and is not closed yet), per channel type window.
   */
  private windowExpiringQuery(
    companyId: string,
    ownerId: string | null,
    now: Date,
  ): SelectQueryBuilder<Conversation> {
    const windows = new Map<number, ChannelType[]>();
    for (const [type, capabilities] of Object.entries(CHANNEL_CAPABILITIES)) {
      const windowMs = capabilities?.replyWindowMs;
      if (!windowMs) continue;
      windows.set(windowMs, [...(windows.get(windowMs) ?? []), type as ChannelType]);
    }

    const qb = this.owned(this.activeConversations(companyId), ownerId).innerJoin(
      'conversation.channel',
      'channel',
    );
    if (!windows.size) return qb.andWhere('1 = 0');

    let index = 0;
    return qb.andWhere(
      new Brackets((where) => {
        for (const [windowMs, types] of windows) {
          const i = index++;
          where.orWhere(
            `(channel.type IN (:...types${i}) AND conversation.last_inbound_at > :from${i} AND conversation.last_inbound_at <= :to${i})`,
            {
              [`types${i}`]: types,
              [`from${i}`]: new Date(now.getTime() - windowMs),
              [`to${i}`]: new Date(now.getTime() - windowMs + WINDOW_EXPIRING_MS),
            },
          );
        }
      }),
    );
  }

  /** Customer, channel, window and owner of every signal conversation (2 queries). */
  private async signalDetails(ids: string[]) {
    const unique = [...new Set(ids)];
    const result = new Map<
      string,
      {
        customer: WorkSignal['customer'];
        channelType: ChannelType;
        lastInboundAt: Date | null;
        lastMessageAt: Date | null;
        createdAt: Date;
        windowExpiresAt: Date | null;
        assignee: TaskMemberRef | null;
      }
    >();
    if (!unique.length) return result;

    const [conversations, owners] = await Promise.all([
      this.dataSource
        .getRepository(Conversation)
        .createQueryBuilder('conversation')
        .innerJoinAndSelect('conversation.channel', 'channel')
        .withDeleted()
        .innerJoinAndSelect('conversation.customer', 'customer')
        .where('conversation.id IN (:...ids)', { ids: unique })
        .andWhere('conversation.deleted_at IS NULL')
        .getMany(),
      this.dataSource.getRepository(ConversationAssignment).find({
        where: { conversationId: In(unique), unassignedAt: IsNull() },
        relations: { member: { user: true } },
        withDeleted: true,
      }),
    ]);

    const ownerByConversation = new Map<string, CompanyMember>();
    for (const row of owners) {
      if (row.member) ownerByConversation.set(row.conversationId, row.member);
    }

    for (const conversation of conversations) {
      const owner = ownerByConversation.get(conversation.id);
      result.set(conversation.id, {
        customer: {
          id: conversation.customer.id,
          displayName: conversation.customer.displayName ?? null,
          phone: conversation.customer.phoneNumber ?? null,
        },
        channelType: conversation.channel.type,
        lastInboundAt: conversation.lastInboundAt ?? null,
        lastMessageAt: conversation.lastMessageAt ?? null,
        createdAt: conversation.createdAt,
        windowExpiresAt: replyWindowExpiresAt(conversation.channel.type, conversation.lastInboundAt),
        assignee: owner ? { memberId: owner.id, name: memberDisplayName(owner.user) } : null,
      });
    }

    return result;
  }
}
