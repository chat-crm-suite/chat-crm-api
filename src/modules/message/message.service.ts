import { Injectable } from '@nestjs/common';

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

@Injectable()
export class MessageService {
  constructor(private readonly repo: MessageRepository) {}

  /**
   * Persists an inbound/outbound message, its attachments and refreshes the
   * conversation preview (`last_message_id` / `last_message_at`).
   */
  saveMessage(params: {
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
  }): Promise<Message> {
    return this.repo.create({
      ...params,
      status: params.status ?? 'pending',
    });
  }

  /**
   * Applies one Meta delivery state (`sent`/`delivered`/`read`/`failed`) to
   * the message carrying that `wamid`. Unknown wamids and regressions
   * (`pending < sent < delivered < read`, `failed` terminal) are ignored, so
   * the row only ever moves forward (docs/database/README.md §2).
   */
  async applyDeliveryStatus(
    update: DeliveryStatusUpdate,
  ): Promise<DeliveryStatusOutcome> {
    const message = await this.repo.findByExternalId(update.wamid);
    if (!message) return { applied: false, message: null };

    if (!isStatusAdvance(message.status, update.status)) {
      return { applied: false, message };
    }

    const saved = await this.repo.applyStatus(message.id, update);
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
