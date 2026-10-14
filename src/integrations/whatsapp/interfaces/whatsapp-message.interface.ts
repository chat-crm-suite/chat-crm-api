// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * WhatsApp Cloud API `POST /{phone-number-id}/messages` request bodies.
 * @link https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
export interface WhatsAppPayloadBase {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  /** `wa_id` or E.164 phone of the customer. */
  to: string;
}

export interface WhatsAppTextContent {
  body: string;
  preview_url?: boolean;
}

/** Media is referenced by the id Graph returned for an upload (or a link). */
export interface WhatsAppMediaContent {
  id?: string;
  link?: string;
  caption?: string;
}

export interface WhatsAppDocumentContent extends WhatsAppMediaContent {
  filename?: string;
}

export interface WhatsAppTextMessage extends WhatsAppPayloadBase {
  type: 'text';
  text: WhatsAppTextContent;
}

export interface WhatsAppImageMessage extends WhatsAppPayloadBase {
  type: 'image';
  image: WhatsAppMediaContent;
}

export interface WhatsAppVideoMessage extends WhatsAppPayloadBase {
  type: 'video';
  video: WhatsAppMediaContent;
}

/** Audio takes no caption; an `audio/ogg` (opus) file renders as a voice note. */
export interface WhatsAppAudioMessage extends WhatsAppPayloadBase {
  type: 'audio';
  audio: Pick<WhatsAppMediaContent, 'id' | 'link'>;
}

export interface WhatsAppDocumentMessage extends WhatsAppPayloadBase {
  type: 'document';
  document: WhatsAppDocumentContent;
}

export interface WhatsAppStickerMessage extends WhatsAppPayloadBase {
  type: 'sticker';
  sticker: Pick<WhatsAppMediaContent, 'id' | 'link'>;
}

export type WhatsAppPayload =
  | WhatsAppTextMessage
  | WhatsAppImageMessage
  | WhatsAppVideoMessage
  | WhatsAppAudioMessage
  | WhatsAppDocumentMessage
  | WhatsAppStickerMessage;

export type WhatsAppMessageType = WhatsAppPayload['type'];
