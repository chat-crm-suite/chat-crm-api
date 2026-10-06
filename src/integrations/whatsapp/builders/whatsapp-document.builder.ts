// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppDocumentMessage } from '../interfaces/whatsapp-message.interface';
import { WhatsAppBaseBuilder } from "./whatsapp-base.builder";

export class WhatsAppDocumentBuilder extends WhatsAppBaseBuilder<WhatsAppDocumentBuilder, WhatsAppDocumentMessage> {
  constructor() {
    super();
    this.setType('document');
    this.payload.document = {};
  }

  link(link?: string) {
    this.payload.document = { link };
    return this;
  }

  caption(caption?: string) {
    this.payload.document = { caption };
    return this;
  }

  filaname(filename?: string) {
    this.payload.document = { filename };
    return this;
  }

  protected override validate(): void {
    super.validate();
    if (!this.payload.document?.link) {
      throw new Error('The link from document message is required');
    }
  }
}