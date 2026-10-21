// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  ConversationMessage,
  MediaRef,
  MessageView,
} from '@contracts';
import { attachmentMediaUrl } from '../attachment-url';
import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message } from '../entities/message.entity';

/** Sender id falls back to `system` when neither FK is present. */
export function getMessageSender(
  message: Message,
): ConversationMessage['sender'] {
  return {
    id: message.senderMemberId ?? message.senderCustomerId ?? 'system',
    type: message.senderType,
  };
}

/**
 * A persisted message (plus its attachments) as the REST history and the
 * socket broadcast expose it. The media URL is always our membership-checked
 * attachments endpoint, never a provider or storage path.
 */
export function toConversationMessage(
  message: Message,
  attachments: MessageAttachment[] = [],
): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    clientMessageId: message.clientMessageId ?? null,
    timestamp: message.createdAt,
    status: message.status,
    sender: getMessageSender(message),
    msg: toMessageView(message, attachments[0]),
  };
}

/** Exhaustive over the persisted kinds: a new kind fails to compile here. */
export function toMessageView(
  message: Message,
  attachment?: MessageAttachment,
): MessageView {
  const text = message.body ?? null;

  switch (message.type) {
    case 'text':
      return { type: 'text', text: text ?? '' };
    case 'image':
    case 'video':
      return { type: message.type, media: toMediaRef(attachment), caption: text };
    case 'audio':
      return {
        type: 'audio',
        media: toMediaRef(attachment),
        voice: isVoiceNote(attachment?.mimeType),
      };
    case 'document':
      return {
        type: 'document',
        media: toMediaRef(attachment),
        filename: attachment?.fileName ?? null,
        caption: text,
      };
    case 'sticker':
      return { type: 'sticker', media: toMediaRef(attachment) };
    case 'template':
      return toTemplateView(message, attachment);
    case 'location':
    case 'contact':
    case 'interactive':
    case 'reaction':
      return { type: 'unsupported', originalType: message.type, text };
    default:
      return unreachable(message.type);
  }
}

/**
 * A sent template from its snapshot; the header file is the message's
 * attachment. Rows sent before snapshots existed only have their text.
 */
function toTemplateView(
  message: Message,
  attachment?: MessageAttachment,
): Extract<MessageView, { type: 'template' }> {
  const snapshot = message.templateSnapshot;
  const header = snapshot?.header ?? null;

  return {
    type: 'template',
    templateId: message.templateId ?? null,
    name: snapshot?.name ?? '',
    language: snapshot?.language ?? '',
    header:
      header?.kind === 'media'
        ? {
            kind: 'media',
            mediaType: header.mediaType,
            media: toMediaRef(attachment),
            filename: attachment?.fileName ?? header.filename,
          }
        : header,
    body: snapshot?.body ?? message.body ?? '',
    footer: snapshot?.footer ?? null,
    buttons: snapshot?.buttons ?? [],
  };
}

/**
 * The file behind a media message. A row without attachment (legacy data)
 * reads as `failed`: there is nothing to show, and saying so is honest.
 */
export function toMediaRef(attachment?: MessageAttachment | null): MediaRef {
  return {
    attachmentId: attachment?.id ?? null,
    url: attachmentMediaUrl(attachment),
    status: attachment?.status ?? 'failed',
    mimeType: attachment?.mimeType ?? null,
    sizeBytes: attachment?.sizeBytes ?? null,
    durationMs: attachment?.durationMs ?? null,
    width: attachment?.width ?? null,
    height: attachment?.height ?? null,
  };
}

/**
 * Voice notes are Opus in an Ogg container: that is what WhatsApp records
 * and the only audio it renders as a voice note, so the kind is derived from
 * the file instead of being stored apart.
 */
export function isVoiceNote(mimeType?: string | null): boolean {
  return (mimeType ?? '').toLowerCase().startsWith('audio/ogg');
}

function unreachable(type: never): never {
  throw new Error(`Unmapped message type: ${String(type)}`);
}
