// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundMessage } from '../types/inbound-message.types';

export class ReceiveWhatsAppMessageCommand {
  constructor(public readonly message: InboundMessage) {}
}
