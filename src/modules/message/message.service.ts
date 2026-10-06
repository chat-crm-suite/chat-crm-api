// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';

import {
  isDeadlockError,
  isDuplicateKeyError,
} from '../../lib/helpers/query-error.helper';
import type {
  AttachmentStatus,
  AttachmentType,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';
import type { MessageAttachment } from './entities/message-attachment.entity';
import type { Message } from './entities/message.entity';
import { toConversationMessagePayload } from './mappers/conversation-message.mapper';
import { MessageRepository } from './message.repository';
import type { ConversationMessagePayload } from './message.types';
import { MESSAGE_STRATEGY_REGISTRY } from './strategies/strategy.registry';

export interface DeliveryStatusUpdate {
  /** Meta message id: matched against `messages.external_id`. */
  wamid: string;
  status: MessageStatus;
  /** Meta's status timestamp; persisted as `status_updated_at`. */
  occurredAt: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface DeliveryStatusOutcome {
  applied: boolean;
  message: Message | null;
}

/** Persist input shared by the inbound save and the T5 outbound save. */
export interface SaveMessageParams {
  companyId: string;
  conversationId: string;
  type: MessageType;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderMemberId?: string | null;
  senderCustomerId?: string | null;
  body?: string | null;
  externalId?: string | null;
  clientMessageId?: string | null;
  status?: MessageStatus;
  attachments?: Array<{
    type: AttachmentType;
    mimeType?: string;
    fileName?: string;
    storageUrl?: string;
    externalMediaId?: string;
    status?: AttachmentStatus;
    sizeBytes?: number | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  }>;
}

@Injectable()
export class MessageService {
  constructor(private readonly repo: MessageRepository) {}

  /**
   * Persists an inbound/outbound message, its attachments and refreshes the
   * conversation preview (`last_message_id` / `last_message_at`).
   */
  saveMessage(params: SaveMessageParams): Promise<Message> {
    return this.repo.create({
      ...params,
      status: params.status ?? 'pending',
    });
  }

  /**
   * T5: outbound save, idempotent by `client_message_id`. A double submit
   * returns the already-saved row with `created: false` instead of inserting a
   * second one (the DB unique index settles concurrent submits).
   */
  async saveOutbound(
    params: SaveMessageParams,
  ): Promise<{ message: Message; created: boolean }> {
    const clientMessageId = params.clientMessageId ?? null;

    if (clientMessageId) {
      const existing = await this.repo.findByClientMessageId(
        params.conversationId,
        clientMessageId,
      );
      if (existing) return { message: existing, created: false };
    }

    // Two concurrent submits can deadlock (unique index vs the conversation
    // preview update) or lose the unique-index race; both are transient, and
    // the retry either finds the winner's row or inserts after it commits.
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const message = await this.saveMessage(params);
        return { message, created: true };
      } catch (error: unknown) {
        lastError = error;

        if (
          !clientMessageId ||
          (!isDuplicateKeyError(error) && !isDeadlockError(error))
        ) {
          throw error;
        }

        const existing = await this.repo.findByClientMessageId(
          params.conversationId,
          clientMessageId,
        );
        if (existing) return { message: existing, created: false };
      }
    }

    throw lastError;
  }

  /**
   * Applies one Meta delivery state (`sent`/`delivered`/`read`/`failed`) to
   * the message carrying that `wamid`. Unknown wamids and regressions
   * (`pending < sent < delivered < read`, `failed` terminal) are ignored, so
   * the row only ever moves forward (docs/database/README.md — Message lifecycle).
   */
  async applyDeliveryStatus(
    update: DeliveryStatusUpdate,
  ): Promise<DeliveryStatusOutcome> {
    const message = await this.repo.findByExternalId(update.wamid);
    if (!message) return { applied: false, message: null };

    if (!isStatusAdvance(message.status, update.status)) {
      return { applied: false, message };
    }

    // Compare-and-set: only the statuses the incoming state may advance from
    // are accepted, so a concurrent status landing first wins and this update
    // becomes a noop instead of a regression.
    const allowedFrom = (Object.keys(STATUS_RANK) as MessageStatus[]).filter(
      (status) => isStatusAdvance(status, update.status),
    );

    const saved = await this.repo.applyStatus(message.id, update, allowedFrom);
    if (!saved) {
      return {
        applied: false,
        message: await this.repo.findByExternalId(update.wamid),
      };
    }

    return { applied: true, message: saved };
  }

  /**
   * `GET /conversations/:id/messages` payload, newest first (same order as the
   * legacy `GET /chats/:id/messages`).
   */
  async getConversationMessages(
    conversationId: string,
  ): Promise<ConversationMessagePayload[]> {
    const messages = await this.repo.findConversationMessages(conversationId);
    const attachments = await this.repo.findAttachmentsByMessageIds(
      messages.map((message) => message.id),
    );

    const attachmentsByMessage = new Map<string, MessageAttachment[]>();

    for (const attachment of attachments) {
      const list = attachmentsByMessage.get(attachment.messageId) ?? [];
      list.push(attachment);
      attachmentsByMessage.set(attachment.messageId, list);
    }

    return messages.map((message) => {
      const rows = attachmentsByMessage.get(message.id) ?? [];
      const strategy = MESSAGE_STRATEGY_REGISTRY[message.type];

      return strategy
        ? strategy.toBroadcastFields(message, rows)
        : toConversationMessagePayload(message, rows);
    });
  }

  /**
   * Single-message broadcast payload. The saga uses it so live broadcasts
   * carry the same `mediaUrl` as the REST history (the saved entity alone
   * has no attachments loaded).
   */
  async getMessagePayload(
    messageId: string,
  ): Promise<ConversationMessagePayload | null> {
    const message = await this.repo.findById(messageId);
    if (!message) return null;

    const attachments = await this.repo.findAttachmentsByMessageIds([
      message.id,
    ]);
    const strategy = MESSAGE_STRATEGY_REGISTRY[message.type];

    return strategy
      ? strategy.toBroadcastFields(message, attachments)
      : toConversationMessagePayload(message, attachments);
  }

  /** Replay idempotency: does this wamid already have a persisted row? */
  findByExternalId(externalId: string): Promise<Message | null> {
    return this.repo.findByExternalId(externalId);
  }

  /**
   * T5: Graph answered the send with a wamid: the pending row becomes `sent`
   * and keeps the provider id. A row already moved returns `null`.
   */
  markSent(
    messageId: string,
    wamid: string,
    at: Date = new Date(),
  ): Promise<Message | null> {
    return this.repo.markSent(messageId, wamid, at);
  }

  /**
   * T5: the send failed for good: the row stays in the thread as `failed`
   * with the provider error. A row already moved returns `null`.
   */
  markSendFailed(
    messageId: string,
    error: { code?: string | null; message?: string | null },
    at: Date = new Date(),
  ): Promise<Message | null> {
    return this.repo.markSendFailed(messageId, error, at);
  }

  /** T3: attachments of a saved row still waiting for their media file. */
  findPendingMediaAttachments(messageId: string): Promise<MessageAttachment[]> {
    return this.repo.findPendingMediaAttachments(messageId);
  }

  /** T3: stores the downloaded file data on a pending attachment. */
  markAttachmentReady(
    attachmentId: string,
    data: { storageUrl: string; mimeType?: string; sizeBytes?: number | null },
  ): Promise<MessageAttachment | null> {
    return this.repo.markAttachmentReady(attachmentId, data);
  }

  /** T3: media failure leaves the message row intact, only the file is gone. */
  markAttachmentFailed(
    attachmentId: string,
  ): Promise<MessageAttachment | null> {
    return this.repo.markAttachmentFailed(attachmentId);
  }
}

/** `failed` is terminal; the rest only move forward, never backwards. */
const STATUS_RANK: Record<MessageStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

function isStatusAdvance(
  current: MessageStatus,
  incoming: MessageStatus,
): boolean {
  if (current === incoming) return false;
  if (incoming === 'failed') return true;
  if (current === 'failed') return false;

  return STATUS_RANK[incoming] > STATUS_RANK[current];
}
