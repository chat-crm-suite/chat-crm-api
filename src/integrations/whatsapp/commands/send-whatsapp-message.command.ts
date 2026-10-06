// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';

export class SendWhatsAppMessageCommand {
  constructor(
    public readonly payload: WhatsAppPayload,
    public readonly companyId?: string,
  ) {}
}
