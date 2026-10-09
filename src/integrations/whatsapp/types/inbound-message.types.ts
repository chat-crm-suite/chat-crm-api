// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  WhatsappNotificationError,
  WhatsappNotificationStatus,
} from '@daweto/whatsapp-api-types';

import type {
  AudioContent as LegacyAudioContent,
  ContactContent as LegacyContactContent,
  ContactPerson as LegacyContactPerson,
  DocumentContent as LegacyDocumentContent,
  ImageContent as LegacyImageContent,
  InteractiveContent as LegacyInteractiveContent,
  LocationContent as LegacyLocationContent,
  MessageContent as LegacyMessageContent,
  ReactionContent as LegacyReactionContent,
  StickerContent as LegacyStickerContent,
  TextContent as LegacyTextContent,
  VideoContent as LegacyVideoContent,
} from './whatsapp.types';

/**
 * Layer 2 of the inbound domain (ticket #20 expand): the normalized,
 * not-yet-stored inbound message — context (channel id, sender, message id
 * and sender name) plus typed content. Canonical new names; the legacy
 * `Message*` / `ParsedMessage` aliases below keep the old surface working.
 * Zero behavior change: structural twins of `whatsapp.types.ts`.
 */
export interface InboundMessageContext {
  phoneNumberId: string; // Company Phone ID
  from: string;
  messageId: string;
  senderName?: string;
}

export type InboundTextContent = LegacyTextContent;
export type InboundImageContent = LegacyImageContent;
export type InboundDocumentContent = LegacyDocumentContent;
export type InboundAudioContent = LegacyAudioContent;
export type InboundVideoContent = LegacyVideoContent;
export type InboundStickerContent = LegacyStickerContent;
export type InboundLocationContent = LegacyLocationContent;
export type InboundContactPerson = LegacyContactPerson;
export type InboundContactContent = LegacyContactContent;
export type InboundInteractiveContent = LegacyInteractiveContent;
export type InboundReactionContent = LegacyReactionContent;

export type InboundMessageContent = LegacyMessageContent;

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

// --- Legacy aliases (old names keep working via the new surface) ---

export type MessageContext = InboundMessageContext;
export type TextContent = InboundTextContent;
export type ImageContent = InboundImageContent;
export type DocumentContent = InboundDocumentContent;
export type AudioContent = InboundAudioContent;
export type VideoContent = InboundVideoContent;
export type StickerContent = InboundStickerContent;
export type LocationContent = InboundLocationContent;
export type ContactPerson = InboundContactPerson;
export type ContactContent = InboundContactContent;
export type InteractiveContent = InboundInteractiveContent;
export type ReactionContent = InboundReactionContent;
export type MessageContent = InboundMessageContent;
export type ParsedMessage = InboundMessage;
export type WebhookResult = InboundWebhookResult;
