// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppImageBuilder } from '../../../integrations/whatsapp/builders/whatsapp-image.builder';
import type {
  WhatsAppMediaContent,
  WhatsAppPayload,
} from '../../../integrations/whatsapp/interfaces/whatsapp-message.interface';
import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message } from '../entities/message.entity';
import { getConversationMessageBase } from '../mappers/conversation-message.mapper';
import type { ConversationMessagePayload } from '../message.types';
import type { MessageStrategy } from './message.strategy';

export class ImageMessageStrategy implements MessageStrategy {
  toWhatsAppPayload(
    to: string,
    content: WhatsAppMediaContent,
  ): WhatsAppPayload {
    const payload = new WhatsAppImageBuilder()
      .to(to)
      .link(content.link)
      .build();

    // The builder setters replace `image`, so the optional caption is merged
    // after building.
    if (payload.type === 'image' && content.caption) {
      payload.image.caption = content.caption;
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
        type: 'image',
        mediaUrl: attachment?.storageUrl ?? null,
        attachmentStatus: attachment?.status ?? null,
        mimeType: attachment?.mimeType ?? null,
        sizeBytes: attachment?.sizeBytes ?? null,
        content: { caption: message.body ?? undefined },
      },
    };
  }
}
