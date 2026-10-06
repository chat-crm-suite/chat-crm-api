// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  WhatsAppMessageContent,
  WhatsAppPayload,
} from '../../../integrations/whatsapp/interfaces/whatsapp-message.interface';
import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message } from '../entities/message.entity';
import type { ConversationMessagePayload } from '../message.types';

export interface MessageStrategy {
  /** Builds the WhatsApp Cloud API payload for an outbound message. */
  toWhatsAppPayload(
    to: string,
    content: WhatsAppMessageContent,
  ): WhatsAppPayload;

  /**
   * Maps a persisted message (plus its attachments) to the v2 REST/socket
   * payload (`GET /conversations/:id/messages`).
   */
  toBroadcastFields(
    message: Message,
    attachments?: MessageAttachment[],
  ): ConversationMessagePayload;
}
