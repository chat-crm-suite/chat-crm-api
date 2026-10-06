// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

export class FailWhatsAppMessageCommand {
  constructor(
    public readonly recipientId: string,
    public readonly err: WhatsappNotificationError,
    public readonly waId?: string,
  ) {}
}
