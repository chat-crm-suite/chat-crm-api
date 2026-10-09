// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { attachmentMediaUrl } from '../attachment-url';
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
  | 'id'
  | 'conversationId'
  | 'timestamp'
  | 'status'
  | 'clientMessageId'
  | 'sender'
> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    timestamp: message.createdAt,
    status: message.status,
    clientMessageId: message.clientMessageId ?? null,
    sender: getMessageSender(message),
  };
}

/**
 * Generic mapping for message types without a dedicated strategy:
 * `body` for text-only messages; otherwise the first attachment provides the
 * media (`link` = our attachments endpoint, `caption` = body, `filename` =
 * fileName). The provider/storage path is never exposed.
 */
export function toConversationMessagePayload(
  message: Message,
  attachments: MessageAttachment[] = [],
): ConversationMessagePayload {
  const [attachment] = attachments;
  const content: ConversationMessagePayload['msg']['content'] = {};
  const mediaUrl = attachmentMediaUrl(attachment);

  if (message.body) {
    if (attachment) {
      content.caption = message.body;
    } else {
      content.body = message.body;
    }
  }

  if (mediaUrl) content.link = mediaUrl;
  if (attachment?.fileName) content.filename = attachment.fileName;

  return {
    ...getConversationMessageBase(message),
    msg: {
      type: message.type,
      mediaUrl,
      attachmentStatus: attachment?.status ?? null,
      mimeType: attachment?.mimeType ?? null,
      sizeBytes: attachment?.sizeBytes ?? null,
      content,
    },
  };
}
