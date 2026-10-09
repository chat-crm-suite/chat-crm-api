// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundMessageContent } from '../types/inbound-message.types';
import { WhatsAppTextBuilder } from './whatsapp-text.builder';

export class WhatsAppMessageBuilder {
  constructor(
    private readonly to: string,
    private readonly content: InboundMessageContent,
  ) {}

  build() {
    switch (this.content.type) {
      case 'text':
        return this.text().to(this.to).body(this.content.text.body).build();
    }
  }

  text() {
    return new WhatsAppTextBuilder();
  }
}
