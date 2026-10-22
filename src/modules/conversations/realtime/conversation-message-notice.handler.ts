// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import { conversationGroupKey, NotificationTypeSchema, type MessageType } from '@contracts';
import type { Message } from '../../message/entities/message.entity';
import { NotificationDispatcher } from '../../notifications/notification.dispatcher';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { Conversation } from '../entities/conversation.entity';
import { MessageSavedEvent } from '../events/message-saved.event';

export const MESSAGE_NOTIFICATION_TYPE = NotificationTypeSchema.enum.conversation_message;
/** Longest preview kept in the notice body. */
const PREVIEW_MAX = 140;
/**
 * A message that arrives right as the chat gets assigned is already
 * announced by "Nuevo chat asignado": no second notice for it.
 */
const ASSIGNMENT_GRACE_MS = 10_000;

const MEDIA_LABELS: Partial<Record<MessageType, string>> = {
  image: 'Imagen',
  audio: 'Audio',
  video: 'Video',
  document: 'Documento',
  sticker: 'Sticker',
  location: 'Ubicación',
  contact: 'Contacto',
};

/** Text preview, or a label for media without caption. */
export function messagePreview(message: Pick<Message, 'type' | 'body'>): string {
  const text = message.body?.trim();
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;

  return MEDIA_LABELS[message.type] ?? 'Mensaje nuevo';
}

/**
 * A customer wrote: the assignee gets one notice per chat that grows with the
 * burst ("Ana (3)", latest message as body), WhatsApp style. Unassigned chats
 * are the queue notice's job; reactions never notify. Whether the chat is on
 * screen is the client's call (it reads the notice when the chat is open).
 * Never throws: the message pipeline must not break on it.
 */
@EventsHandler(MessageSavedEvent)
export class ConversationMessageNoticeHandler implements IEventHandler<MessageSavedEvent> {
  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly assignments: ConversationAssignmentService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationMessageNoticeHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    if (message.senderType !== 'customer' || message.type === 'reaction') return;

    try {
      const assignment = await this.assignments.getActiveAssignment(message.conversationId);
      if (!assignment?.memberId) return;

      const sentAt = new Date(message.createdAt ?? Date.now()).getTime();
      if (sentAt - new Date(assignment.assignedAt).getTime() < ASSIGNMENT_GRACE_MS) return;

      const conversation = await this.dataSource.getRepository(Conversation).findOne({
        where: { id: message.conversationId },
        relations: { customer: true },
        select: {
          id: true,
          companyId: true,
          customer: { id: true, displayName: true, phoneNumber: true },
        },
      });
      if (!conversation) return;

      const customer =
        conversation.customer?.displayName?.trim() ||
        conversation.customer?.phoneNumber ||
        'Cliente';

      await this.dispatcher.notify({
        companyId: conversation.companyId,
        type: MESSAGE_NOTIFICATION_TYPE,
        audience: { memberIds: [assignment.memberId] },
        title: customer,
        body: messagePreview(message),
        data: { conversationId: conversation.id },
        dedupeKey: `message:${message.id}`,
        groupKey: conversationGroupKey(conversation.id),
      });
    } catch (error) {
      this.logger.warn(
        { conversationId: message.conversationId, error: String(error) },
        'Message notice failed',
      );
    }
  }
}
