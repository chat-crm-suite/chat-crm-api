// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppMessage } from ".";

export interface WhatsAppImageContent {
  link: string;
  caption?: string;
}

export interface WhatsAppImageMessage extends WhatsAppMessage {
  type: 'image';
  image: WhatsAppImageContent;
}