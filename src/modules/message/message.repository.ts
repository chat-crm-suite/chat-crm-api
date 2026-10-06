import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import type {
  AttachmentStatus,
  AttachmentType,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../../contracts/index';
import { Conversation } from '../conversations/entities/conversation.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessageStatusEvent } from './entities/message-status-event.entity';
import { Message } from './entities/message.entity';

export interface SaveMessageAttachment {
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
              status: attachment.status ?? 'ready',
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

  findById(messageId: string): Promise<Message | null> {
    return this.messages.findOne({ where: { id: messageId } });
  }

  /** The message a Meta status refers to: `external_id` is the Graph `wamid`. */
  findByExternalId(externalId: string): Promise<Message | null> {
    return this.messages.findOne({
      where: { externalId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Applies one Meta delivery state to the message row and appends the
   * transition to the append-only history, in a single transaction. The
   * caller owns the transition policy (`MessageService`).
   */
  async applyStatus(
    messageId: string,
    update: {
      status: MessageStatus;
      occurredAt: Date;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<Message> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        Message,
        { id: messageId },
        {
          status: update.status,
          statusUpdatedAt: update.occurredAt,
          // Column limits guard against oversized Meta errors.
          errorCode: update.errorCode?.slice(0, 50) ?? null,
          errorMessage: update.errorMessage?.slice(0, 500) ?? null,
        },
      );

      await manager.save(
        manager.create(MessageStatusEvent, {
          messageId,
          status: update.status,
          occurredAt: update.occurredAt,
          errorCode: update.errorCode?.slice(0, 50) ?? null,
        }),
      );

      return manager.findOneByOrFail(Message, { id: messageId });
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

  /** T3 enrichment input: attachments still waiting for their file. */
  findPendingMediaAttachments(messageId: string): Promise<MessageAttachment[]> {
    return this.attachments.find({
      where: {
        messageId,
        status: 'pending',
        externalMediaId: Not(IsNull()),
      },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * T3 enrichment result. Only a `pending` attachment can transition, so a
   * duplicate enrichment pass can never resurrect a failed one.
   */
  async markAttachmentReady(
    attachmentId: string,
    data: { storageUrl: string; mimeType?: string; sizeBytes?: number | null },
  ): Promise<MessageAttachment | null> {
    const result = await this.attachments.update(
      { id: attachmentId, status: 'pending' },
      {
        status: 'ready',
        storageUrl: data.storageUrl,
        ...(data.mimeType !== undefined ? { mimeType: data.mimeType } : {}),
        sizeBytes: data.sizeBytes ?? null,
      },
    );

    // A concurrent pass already settled it: no second transition, no patch.
    if (!result.affected) return null;

    return this.attachments.findOne({ where: { id: attachmentId } });
  }

  /** Media failure is terminal for the attachment; the message row stays. */
  async markAttachmentFailed(
    attachmentId: string,
  ): Promise<MessageAttachment | null> {
    const result = await this.attachments.update(
      { id: attachmentId, status: 'pending' },
      { status: 'failed' },
    );

    if (!result.affected) return null;

    return this.attachments.findOne({ where: { id: attachmentId } });
  }
}
