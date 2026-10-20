// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

import {
  ConversationSocketEvent,
  type ConversationListItem,
  type ConversationMessageAttachmentPatch,
  type ConversationMessageStatusPatch,
  type ConversationStatusChanged,
} from '@contracts';
import type { ConversationMessage } from '@contracts';
import {
  conversationRoom,
  ConversationGateway,
  roleRoom,
  staffRooms,
  userRoom,
} from '../gateways/conversation.gateway';
import { ConversationAccessService } from './conversation-access.service';

/**
 * T6 single fanout path for conversation content.
 *
 * Message bodies and delivery patches leave through here: the conversation
 * room carries the thread, the assignee's personal room carries the preview
 * for their other sessions (excluding the thread room, so a socket in both
 * does not receive the event twice). The company room is deliberately never a
 * target, so no body can leak to a company-wide audience; membership is
 * enforced on join by `ConversationAccessService`. Queue and lifecycle
 * pings go to role rooms (see `toAudience`), never the whole company.
 */
@Injectable()
export class ConversationFanoutService {
  constructor(
    private readonly gateway: ConversationGateway,
    private readonly access: ConversationAccessService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationFanoutService.name);
  }

  /** Live message body: open thread + assignee preview. */
  emitMessage(
    conversationId: string,
    payload: ConversationMessage,
  ): Promise<void> {
    return this.emitToThreadAndAssignee(
      conversationId,
      ConversationSocketEvent.BroadcastMessage,
      payload,
    );
  }

  /** Live delivery-state patch: same routing as the message body. */
  emitStatusPatch(patch: ConversationMessageStatusPatch): Promise<void> {
    return this.emitToThreadAndAssignee(
      patch.conversationId,
      ConversationSocketEvent.MessageStatus,
      patch,
    );
  }

  /** Live media-enrichment patch: same routing as the message body. */
  emitAttachmentPatch(
    patch: ConversationMessageAttachmentPatch,
  ): Promise<void> {
    return this.emitToThreadAndAssignee(
      patch.conversationId,
      ConversationSocketEvent.MessageAttachment,
      patch,
    );
  }

  /**
   * T5 legacy failure notice: the existing `conversation:message:error` event
   * still reaches the open thread and the assignee, now through the same
   * membership-safe path as every other body.
   */
  emitError(
    conversationId: string,
    error: WhatsappNotificationError,
  ): Promise<void> {
    return this.emitToThreadAndAssignee(
      conversationId,
      ConversationSocketEvent.ErrorMessage,
      error,
    );
  }

  /**
   * Lifecycle change (resolve, pending, reopen, inbound reopen): the open
   * thread, admins/supervisors, and whoever may list the row: the assignee,
   * or every agent while it sits in the queue. Ids and states only.
   */
  async emitStatusChanged(companyId: string, payload: ConversationStatusChanged): Promise<void> {
    if (!this.gateway.server) return;

    try {
      const assignee = await this.access.getActiveAssignee(payload.conversationId);
      this.toAudience(companyId, assignee?.userId ?? null, payload.conversationId).emit(
        ConversationSocketEvent.StatusChanged,
        payload,
      );
    } catch (error) {
      this.logger.warn(
        { conversationId: payload.conversationId, error: String(error) },
        'Status change emit failed',
      );
    }
  }

  /**
   * A conversation started from the CRM, before any message exists. Agents
   * only get it when it is theirs or unassigned: a list item of someone
   * else's conversation is not theirs to see.
   */
  emitCreated(companyId: string, item: ConversationListItem): void {
    if (!this.gateway.server) return;

    this.toAudience(companyId, item.assignee?.userId ?? null).emit(
      ConversationSocketEvent.Created,
      item,
    );
  }

  /** The conversation went back to the queue: every agent may claim it now. */
  emitUnassigned(companyId: string, conversationId: string): void {
    this.gateway.server
      ?.to([...staffRooms(companyId), roleRoom(companyId, 'agent')])
      .emit(ConversationSocketEvent.ConversationUnassigned, { conversationId });
  }

  /**
   * Staff rooms + (assignee | all agents when unassigned) [+ thread], as one
   * emit so a socket in several of these rooms gets the event once.
   */
  private toAudience(companyId: string, assigneeUserId: string | null, conversationId?: string) {
    const rooms = [
      ...staffRooms(companyId),
      assigneeUserId ? userRoom(assigneeUserId) : roleRoom(companyId, 'agent'),
    ];
    if (conversationId) rooms.push(conversationRoom(conversationId));

    return this.gateway.server.to(rooms);
  }

  private async emitToThreadAndAssignee(
    conversationId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    const server = this.gateway.server;
    if (!server || !conversationId) {
      this.logger.warn(
        { conversationId, event },
        'Fanout skipped: no server or conversation',
      );
      return;
    }

    server.to(conversationRoom(conversationId)).emit(event, payload);

    const assignee = await this.access.getActiveAssignee(conversationId);
    if (assignee?.userId) {
      // A socket already in the thread receives the event through the
      // conversation room: the personal-room copy is only the preview for the
      // assignee's other sessions, so it excludes the thread room to avoid a
      // duplicate delivery.
      server
        .to(userRoom(assignee.userId))
        .except(conversationRoom(conversationId))
        .emit(event, payload);
    }
  }
}
