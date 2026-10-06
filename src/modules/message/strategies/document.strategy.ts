// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppDocumentBuilder } from '../../../integrations/whatsapp/builders/whatsapp-document.builder';
import type {
  WhatsAppDocumentContent,
  WhatsAppPayload,
} from '../../../integrations/whatsapp/interfaces/whatsapp-message.interface';
import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message } from '../entities/message.entity';
import { getConversationMessageBase } from '../mappers/conversation-message.mapper';
import type { ConversationMessagePayload } from '../message.types';
import type { MessageStrategy } from './message.strategy';

export class DocumentMessageStrategy implements MessageStrategy {
  toWhatsAppPayload(
    to: string,
    content: WhatsAppDocumentContent,
  ): WhatsAppPayload {
    const payload = new WhatsAppDocumentBuilder()
      .to(to)
      .link(content.link)
      .build();

    // The builder setters replace `document`, so the optional fields are
    // merged after building.
    if (payload.type === 'document' && payload.document) {
      if (content.caption) payload.document.caption = content.caption;
      if (content.filename) payload.document.filename = content.filename;
    }

    return payload;
  }

  toBroadcastFields(
    message: Message,
    attachments: MessageAttachment[] = [],
  ): ConversationMessagePayload {
    const [attachment] = attachments;

    return {
      ...getConversationMessageBase(message),
      msg: {
        type: 'document',
        mediaUrl: attachment?.storageUrl ?? null,
        attachmentStatus: attachment?.status ?? null,
        content: {
          caption: message.body ?? undefined,
          filename: attachment?.fileName,
        },
      },
    };
  }
}
