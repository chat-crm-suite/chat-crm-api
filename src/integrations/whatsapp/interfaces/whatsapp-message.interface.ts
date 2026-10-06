// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * @link https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages#request-syntax
 */
export interface WhatsAppTextMessage extends WhatsAppPayloadBase {
  type: 'text';
  text: WhatsAppTextContent;
}

/**
 * @link https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages#request-syntax
 */
export interface WhatsAppImageMessage extends WhatsAppPayloadBase {
  type: 'image';
  image: WhatsAppMediaContent;
}

/**
 * @link https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/document-messages/#request-syntax
 */
export interface WhatsAppDocumentMessage extends WhatsAppPayloadBase {
  type: 'document';
  document?: WhatsAppDocumentContent;
}

export interface WhatsAppRecipient {
  to: string; // number format E.164: +51999999999
}

export interface WhatsAppTextContent {
  body: string;
  preview_url?: boolean;
}

export interface WhatsAppMediaContent {
  link?: string;       // URL public from hosted media
  id?: string;         // ID uploaded media for meta
  caption?: string;    // Media caption text
}

export interface WhatsAppDocumentContent extends WhatsAppMediaContent {
  filename?: string;
}

/**
 * Respuesta de la API de WhatsApp Business
 */
export interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/**
 * Base payload
 */
export interface WhatsAppPayloadBase {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: WhatsAppMessageType
}

export type WhatsAppMessageContent = WhatsAppTextContent
  | WhatsAppDocumentContent
  | WhatsAppMediaContent;

export type WhatsAppPayload = WhatsAppTextMessage | WhatsAppImageMessage | WhatsAppDocumentMessage;
export type WhatsAppMessageType = 'text' | 'image' | 'document';