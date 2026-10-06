// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppImageMessage } from "./messages/image";
import { WhatsAppTextMessage } from "./messages/text";

export type WhatsAppMessage = WhatsAppTextMessage | WhatsAppImageMessage; // | WhatsAppLocationMessage; // Extendible para otros tipos de mensajes

// Response
export interface WhatsAppSendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: WhatsAppContactResponse[];
  messages: WhatsAppMessageResponse[];
}

export interface WhatsAppContactResponse {
  input: string;   // Número ingresado
  wa_id: string;   // Número normalizado por WhatsApp
}

export interface WhatsAppMessageResponse {
  id: string;      // ID único del mensaje enviado
}
/**
 * @link https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes#example
 */

export interface WhatsAppErrorBody {
  message: string;
  type: string;
  code: number;
  error_data?: {
    messaging_product: string;
    details: string;
  };
  fbtrace_id?: string;
}
export interface WhatsAppErrorResponse {
  error?: WhatsAppErrorBody;
}
