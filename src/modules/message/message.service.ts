import { Injectable } from '@nestjs/common';

import type {
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
}
