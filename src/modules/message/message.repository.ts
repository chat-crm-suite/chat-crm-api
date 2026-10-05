import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type {
  AttachmentType,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';
import { Conversation } from '../conversations/entities/conversation.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { Message } from './entities/message.entity';

export interface SaveMessageAttachment {
  type: AttachmentType;
  mimeType?: string;
  fileName?: string;
  storageUrl?: string;
  externalMediaId?: string;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export interface SaveMessageData {
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
  status: MessageStatus;
  attachments?: SaveMessageAttachment[];
}

@Injectable()
export class MessageRepository {
  constructor(
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(MessageAttachment)
    private readonly attachments: Repository<MessageAttachment>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Inserts the message + its attachments and refreshes
   * `conversations.last_message_id` / `last_message_at` in one transaction.
   */
  async create(data: SaveMessageData): Promise<Message> {
    return this.dataSource.transaction(async (manager) => {
      const message = manager.create(Message, {
        companyId: data.companyId,
        conversationId: data.conversationId,
        direction: data.direction,
        senderType: data.senderType,
        senderMemberId: data.senderMemberId ?? null,
        senderCustomerId: data.senderCustomerId ?? null,
        body: data.body ?? null,
        externalId: data.externalId ?? null,
        clientMessageId: data.clientMessageId ?? null,
        type: data.type,
        status: data.status,
      });

      await manager.save(message);

      if (data.attachments?.length) {
        await manager.save(
          data.attachments.map((attachment) =>
            manager.create(MessageAttachment, {
              messageId: message.id,
              type: attachment.type,
              // Column is NOT NULL; callers may omit the mime type.
              mimeType: attachment.mimeType ?? 'application/octet-stream',
              fileName: attachment.fileName,
              storageUrl: attachment.storageUrl,
              externalMediaId: attachment.externalMediaId,
              sizeBytes: attachment.sizeBytes ?? null,
              width: attachment.width ?? null,
              height: attachment.height ?? null,
              durationMs: attachment.durationMs ?? null,
            }),
          ),
        );
      }

      await manager.update(
        Conversation,
        { id: data.conversationId },
        {
          lastMessageId: message.id,
          // `createdAt` is a DB default, not hydrated after insert.
          lastMessageAt: message.createdAt ?? new Date(),
        },
      );

      return message;
    });
  }

  findConversationMessages(conversationId: string): Promise<Message[]> {
    return this.messages.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
  }

  findAttachmentsByMessageIds(
    messageIds: string[],
  ): Promise<MessageAttachment[]> {
    if (!messageIds.length) return Promise.resolve([]);

    return this.attachments.find({
      where: { messageId: In(messageIds) },
      order: { createdAt: 'ASC' },
    });
  }
}
