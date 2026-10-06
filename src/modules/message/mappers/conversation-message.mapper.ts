// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message } from '../entities/message.entity';
import type { ConversationMessagePayload } from '../message.types';

/** Sender id falls back to `system` when neither FK is present. */
export function getMessageSender(
  message: Message,
): ConversationMessagePayload['sender'] {
  return {
    id: message.senderMemberId ?? message.senderCustomerId ?? 'system',
    type: message.senderType,
  };
}

/** Fields shared by every `ConversationMessagePayload`, whatever the type. */
export function getConversationMessageBase(
  message: Message,
): Pick<
  ConversationMessagePayload,
  'id' | 'conversationId' | 'timestamp' | 'status' | 'sender'
> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    timestamp: message.createdAt,
    status: message.status,
    sender: getMessageSender(message),
  };
}

/**
 * Generic mapping for message types without a dedicated strategy:
 * `body` for text-only messages; otherwise the first attachment provides the
 * media (`link` = storageUrl, `caption` = body, `filename` = fileName).
 */
export function toConversationMessagePayload(
  message: Message,
  attachments: MessageAttachment[] = [],
): ConversationMessagePayload {
  const [attachment] = attachments;
  const content: ConversationMessagePayload['msg']['content'] = {};

  if (message.body) {
    if (attachment) {
      content.caption = message.body;
    } else {
      content.body = message.body;
    }
  }

  if (attachment?.storageUrl) content.link = attachment.storageUrl;
  if (attachment?.fileName) content.filename = attachment.fileName;

  return {
    ...getConversationMessageBase(message),
    msg: {
      type: message.type,
      mediaUrl: attachment?.storageUrl ?? null,
      attachmentStatus: attachment?.status ?? null,
      content,
    },
  };
}
