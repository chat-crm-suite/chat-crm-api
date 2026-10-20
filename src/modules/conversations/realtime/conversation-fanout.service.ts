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
import { ConversationGateway } from '../gateways/conversation.gateway';
import { ConversationAccessService } from './conversation-access.service';

/**
 * T6 single fanout path for conversation content.
 *
 * Message bodies and delivery patches leave through here: the conversation
 * room carries the thread, the assignee's personal room carries the preview
 * for their other sessions (excluding the thread room, so a socket in both
 * does not receive the event twice). The company room is deliberately never a
 * target, so no body can leak to a company-wide audience; membership is
 * enforced on join by `ConversationAccessService`.
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
   * thread and the company room, so every inbox list moves the row. The
   * payload carries ids and states only, never a body.
   */
  emitStatusChanged(companyId: string, payload: ConversationStatusChanged): void {
    const server = this.gateway.server;
    if (!server) return;

    server
      .to(`conversation:${payload.conversationId}`)
      .to(`company:${companyId}`)
      .emit(ConversationSocketEvent.StatusChanged, payload);
  }

  /**
   * A conversation started from the CRM. Emitted right after it is created,
   * before any message exists, so the list item carries no body yet.
   */
  emitCreated(companyId: string, item: ConversationListItem): void {
    this.gateway.server
      ?.to(`company:${companyId}`)
      .emit(ConversationSocketEvent.Created, item);
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

    server.to(`conversation:${conversationId}`).emit(event, payload);

    const assignee = await this.access.getActiveAssignee(conversationId);
    if (assignee?.userId) {
      // A socket already in the thread receives the event through the
      // conversation room: the personal-room copy is only the preview for the
      // assignee's other sessions, so it excludes the thread room to avoid a
      // duplicate delivery.
      server
        .to(`user:${assignee.userId}`)
        .except(`conversation:${conversationId}`)
        .emit(event, payload);
    }
  }
}
