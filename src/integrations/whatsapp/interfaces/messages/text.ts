// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppMessage } from ".";

export interface WhatsAppTextContent {
  preview_url: boolean;
  body: string;
}

export interface WhatsAppTextMessage extends WhatsAppMessage {
  type: 'text';
  text: WhatsAppTextContent;
}