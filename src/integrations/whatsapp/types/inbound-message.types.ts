// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  WhatsappNotificationError,
  WhatsappNotificationStatus,
} from '@daweto/whatsapp-api-types';

/**
 * Layer 2 of the inbound domain (ticket #26 contract): the normalized,
 * not-yet-stored inbound message — context (channel id, sender, message id
 * and sender name) plus typed content. Single vocabulary: every content shape
 * carries the `Inbound` prefix; provider-raw names live in
 * `whatsapp-webhook.types.ts` and conversation names in
 * `conversation-message.types.ts`.
 *
 * Pure data: no behavior, no provider-prefixed names.
 */
export interface InboundMessageContext {
  phoneNumberId: string; // Company Phone ID
  from: string;
  messageId: string;
  senderName?: string;
}

export interface InboundTextContent {
  type: 'text';
  text: {
    body: string;
    preview_url?: boolean;
  };
}

export interface InboundImageContent {
  type: 'image';
  image?: {
    id?: string;
    caption?: string;
    sha256?: string;
    mime_type?: string;
  };
}

export interface InboundDocumentContent {
  type: 'document';
  document?: {
    id: string;
    caption: string;
    filename: string;
    sha256: string;
    mime_type: string;
  };
}

export interface InboundAudioContent {
  type: 'audio';
  audio?: {
    id: string;
    mime_type: string;
  };
}

export interface InboundVideoContent {
  type: 'video';
  video?: {
    id: string;
    caption?: string;
    filename?: string;
    sha256?: string;
    mime_type?: string;
  };
}

export interface InboundStickerContent {
  type: 'sticker';
  sticker?: {
    id: string;
    animated?: boolean;
    sha256?: string;
    mime_type?: string;
  };
}

export interface InboundLocationContent {
  type: 'location';
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    url?: string;
  };
}

export interface InboundContactPerson {
  name?: {
    formatted_name?: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: Array<{ phone?: string; type?: string; wa_id?: string }>;
  emails?: Array<{ email?: string }>;
  org?: { company?: string };
}

export interface InboundContactContent {
  type: 'contact';
  contacts?: InboundContactPerson[];
}

export interface InboundInteractiveContent {
  type: 'interactive';
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
}

export interface InboundReactionContent {
  type: 'reaction';
  reaction?: { message_id?: string; emoji?: string };
}

export type InboundMessageContent =
  | InboundTextContent
  | InboundImageContent
  | InboundDocumentContent
  | InboundAudioContent
  | InboundVideoContent
  | InboundStickerContent
  | InboundLocationContent
  | InboundContactContent
  | InboundInteractiveContent
  | InboundReactionContent;

export interface InboundMessage {
  context: InboundMessageContext;
  content: InboundMessageContent;
}

/** Every provider message type the pipeline resolves today. */
export type InboundMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'reaction'
  | 'button';

export interface InboundWebhookResult {
  messages: InboundMessage[];
  statuses: WhatsappNotificationStatus[];
  errors: WhatsappNotificationError[];
}

/**
 * Why a raw provider message was discarded (ticket #21 strict). Every
 * discard carries one of these reasons on its discard fact — never silence,
 * never an invented default.
 */
export type InboundDiscardReason =
  | 'unknown-type'
  | 'invalid-message'
  | 'missing-message-id'
  | 'missing-sender'
  | 'missing-channel-id'
  | 'missing-text-body'
  | 'missing-media-id'
  | 'missing-location-coordinates'
  | 'missing-contacts'
  | 'missing-button-payload'
  | 'missing-interactive-payload'
  | 'missing-reaction-target';

/** The discard fact the publishing border emits per discarded message. */
export interface InboundDiscard {
  messageId: string;
  type: string;
  reason: InboundDiscardReason;
}
