// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  channelCapabilities,
  type ChannelType,
  type ConversationAssignee,
  type ConversationListItem,
  type ConversationTransfer,
  type ListConversationsQuery,
  type MemberRole,
} from '@contracts';
import { memberDisplayName } from '../../company-members/member-name';
import { Message } from '../../message/entities/message.entity';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { ConversationRead } from '../entities/conversation-read.entity';
import { Conversation } from '../entities/conversation.entity';

/** Who is looking at the list: unread counts and scope checks depend on it. */
export interface ConversationViewer {
  companyId: string;
  memberId: string | null;
  role: MemberRole | null;
}

/** `lastInboundAt + replyWindowMs` of the channel type, or null. */
export function replyWindowExpiresAt(
  channelType: ChannelType | null | undefined,
  lastInboundAt: Date | null | undefined,
): Date | null {
  const windowMs = channelCapabilities(channelType)?.replyWindowMs ?? null;
  if (windowMs === null || !lastInboundAt) return null;

  return new Date(new Date(lastInboundAt).getTime() + windowMs);
}

/**
 * True when free-form replies are refused: the channel has a reply window and
 * it is over, or the customer never wrote.
 */
export function isReplyWindowClosed(
  channelType: ChannelType | null | undefined,
  lastInboundAt: Date | null | undefined,
  now = new Date(),
): boolean {
  const windowMs = channelCapabilities(channelType)?.replyWindowMs ?? null;
  if (windowMs === null) return false;

  const expiresAt = replyWindowExpiresAt(channelType, lastInboundAt);
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}

export const isSupervisorRole = (role: MemberRole | null | undefined) =>
  role === 'admin' || role === 'supervisor';

/**
 * Builds `ConversationListItemSchema` rows for every inbox view (mine, queue,
 * needs-response, all). Callers pick and order the ids; `hydrate` loads the
 * rest with a fixed number of queries whatever the page size (no N+1):
 * conversations + channel + customer + last message, active assignments,
 * transfer context, and unread counts.
 */
@Injectable()
export class ConversationListService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * `GET /conversations`: `mine` = assigned to the viewer, `all` = the whole
   * company (admin/supervisor only). Newest activity first; without `status`
   * closed and archived conversations are left out.
   */
  async listScoped(
    viewer: ConversationViewer,
    query: ListConversationsQuery,
  ): Promise<ConversationListItem[]> {
    if (query.scope === 'all' && !isSupervisorRole(viewer.role)) {
      throw new ForbiddenException('Only admins and supervisors can list every conversation');
    }
    if (query.scope === 'mine' && !viewer.memberId) return [];

    const qb = this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .select('conversation.id', 'id')
      .where('conversation.company_id = :companyId', { companyId: viewer.companyId })
      .andWhere('conversation.deleted_at IS NULL');

    const ownerId = query.scope === 'mine' ? viewer.memberId : query.assigneeId;
    if (ownerId) {
      qb.innerJoin(
        ConversationAssignment,
        'ca',
        'ca.conversation_id = conversation.id AND ca.unassigned_at IS NULL',
      ).andWhere('ca.member_id = :ownerId', { ownerId });
    }

    if (query.status) {
      qb.andWhere('conversation.status = :status', { status: query.status });
    } else {
      qb.andWhere('conversation.status NOT IN (:...inactive)', {
        inactive: ['closed', 'archived'],
      });
    }

    const rows = await qb
      .orderBy('conversation.last_message_at', 'DESC')
      .addOrderBy('conversation.created_at', 'DESC')
      .limit(query.limit)
      .getRawMany<{ id: string }>();

    return this.hydrate(
      rows.map((row) => row.id),
      viewer.memberId,
    );
  }

  /** List items for `ids`, in that order (unknown or deleted ids are skipped). */
  async hydrate(
    ids: readonly string[],
    viewerMemberId?: string | null,
  ): Promise<ConversationListItem[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];

    const conversations = await this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .innerJoinAndSelect('conversation.channel', 'channel')
      // A deleted customer or channel must not make its conversation vanish
      // (the query still filters `conversation.deleted_at`).
      .withDeleted()
      .innerJoinAndSelect('conversation.customer', 'customer')
      .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
      .where('conversation.id IN (:...ids)', { ids: unique })
      .andWhere('conversation.deleted_at IS NULL')
      .getMany();
    if (!conversations.length) return [];

    const found = conversations.map((conversation) => conversation.id);
    const [assignments, unread] = await Promise.all([
      this.activeAssignments(found),
      this.unreadCounts(found, viewerMemberId ?? null),
    ]);
    const transfers = await this.transfers(assignments);

    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const items: ConversationListItem[] = [];
    for (const id of unique) {
      const conversation = byId.get(id);
      if (!conversation) continue;

      const active = assignments.get(id);
      items.push({
        id,
        preview: {
          content: conversation.lastMessage?.body ?? null,
          datetime: conversation.lastMessageAt ?? null,
          type: conversation.lastMessage?.type ?? null,
        },
        customer: {
          id: conversation.customer.id,
          displayName: conversation.customer.displayName ?? null,
          phone: conversation.customer.phoneNumber ?? null,
        },
        channelType: conversation.channel.type,
        channel: {
          id: conversation.channel.id,
          type: conversation.channel.type,
          name: conversation.channel.name,
        },
        status: conversation.status,
        priority: conversation.priority ?? null,
        assignee: active ? toAssignee(active) : null,
        transfer: transfers.get(id) ?? null,
        lastInboundAt: conversation.lastInboundAt ?? null,
        windowExpiresAt: replyWindowExpiresAt(
          conversation.channel.type,
          conversation.lastInboundAt,
        ),
        unread: unread.get(id) ?? 0,
        createdAt: conversation.createdAt,
      });
    }

    return items;
  }

  /** One list item, or null when the conversation is gone. */
  async hydrateOne(
    conversationId: string,
    viewerMemberId?: string | null,
  ): Promise<ConversationListItem | null> {
    const [item] = await this.hydrate([conversationId], viewerMemberId);
    return item ?? null;
  }

  /** Current owner of each conversation (with name), batched. */
  async assignees(ids: readonly string[]): Promise<Map<string, ConversationAssignee>> {
    const active = await this.activeAssignments([...new Set(ids)]);
    return new Map([...active].map(([id, row]) => [id, toAssignee(row)]));
  }

  private async activeAssignments(
    ids: string[],
  ): Promise<Map<string, ConversationAssignment>> {
    if (!ids.length) return new Map();

    const rows = await this.dataSource
      .getRepository(ConversationAssignment)
      .createQueryBuilder('ca')
      // A member removed while still owning it keeps a name.
      .withDeleted()
      .innerJoinAndSelect('ca.member', 'member')
      .innerJoinAndSelect('member.user', 'user')
      .where('ca.conversation_id IN (:...ids)', { ids })
      .andWhere('ca.unassigned_at IS NULL')
      .getMany();

    return new Map(rows.map((row) => [row.conversationId, row]));
  }

  /**
   * Derived "Transferido": the active row has reason `transfer` and its owner
   * has not sent an outbound message since. "From" is the previous owner row.
   */
  private async transfers(
    active: Map<string, ConversationAssignment>,
  ): Promise<Map<string, ConversationTransfer>> {
    const transferred = [...active.values()].filter((row) => row.reason === 'transfer');
    if (!transferred.length) return new Map();

    const ids = transferred.map((row) => row.conversationId);
    const [replied, history] = await Promise.all([
      this.dataSource
        .getRepository(Message)
        .createQueryBuilder('message')
        .innerJoin(
          ConversationAssignment,
          'ca',
          [
            'ca.conversation_id = message.conversation_id',
            'ca.unassigned_at IS NULL',
            'ca.member_id = message.sender_member_id',
            'message.created_at >= ca.assigned_at',
          ].join(' AND '),
        )
        .select('DISTINCT message.conversation_id', 'conversationId')
        .where('message.conversation_id IN (:...ids)', { ids })
        .andWhere('message.direction = :direction', { direction: 'outbound' })
        .getRawMany<{ conversationId: string }>(),
      this.dataSource
        .getRepository(ConversationAssignment)
        .createQueryBuilder('ca')
        .withDeleted()
        .leftJoinAndSelect('ca.member', 'member')
        .leftJoinAndSelect('member.user', 'user')
        .where('ca.conversation_id IN (:...ids)', { ids })
        .andWhere('ca.unassigned_at IS NOT NULL')
        .andWhere('ca.reason != :release', { release: 'release' })
        .orderBy('ca.assigned_at', 'DESC')
        .getMany(),
    ]);

    const answered = new Set(replied.map((row) => row.conversationId));
    const result = new Map<string, ConversationTransfer>();
    for (const row of transferred) {
      if (answered.has(row.conversationId)) continue;

      const previous = history.find(
        (entry) =>
          entry.conversationId === row.conversationId &&
          entry.memberId !== row.memberId &&
          new Date(entry.assignedAt).getTime() <= new Date(row.assignedAt).getTime(),
      );
      result.set(row.conversationId, {
        fromMemberId: previous?.memberId ?? null,
        fromName: previous?.member ? memberDisplayName(previous.member.user) : null,
        at: row.assignedAt,
        note: row.note ?? null,
      });
    }

    return result;
  }

  /**
   * Inbound messages the viewer has not seen: after the last outbound reply
   * and after the viewer's read mark (when one exists).
   */
  private async unreadCounts(
    ids: string[],
    viewerMemberId: string | null,
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();

    const qb = this.dataSource
      .getRepository(Message)
      .createQueryBuilder('message')
      .innerJoin(Conversation, 'conversation', 'conversation.id = message.conversation_id')
      .select('message.conversation_id', 'conversationId')
      .addSelect('COUNT(message.id)', 'unread')
      .where('message.conversation_id IN (:...ids)', { ids })
      .andWhere('message.direction = :direction', { direction: 'inbound' })
      .andWhere(
        '(conversation.last_outbound_at IS NULL OR message.created_at > conversation.last_outbound_at)',
      );

    if (viewerMemberId) {
      qb.leftJoin(
        ConversationRead,
        'reads',
        'reads.conversation_id = message.conversation_id AND reads.member_id = :viewerMemberId',
        { viewerMemberId },
      ).andWhere('(reads.last_read_at IS NULL OR message.created_at > reads.last_read_at)');
    }

    const rows = await qb
      .groupBy('message.conversation_id')
      .getRawMany<{ conversationId: string; unread: string | number }>();

    return new Map(rows.map((row) => [row.conversationId, Number(row.unread) || 0]));
  }
}

function toAssignee(row: ConversationAssignment): ConversationAssignee {
  return {
    memberId: row.memberId,
    userId: row.member.userId,
    name: memberDisplayName(row.member.user),
  };
}
