// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppImageMessage } from "../interfaces/whatsapp-message.interface";
import { WhatsAppBaseBuilder } from "./whatsapp-base.builder";

export class WhatsAppImageBuilder extends WhatsAppBaseBuilder<WhatsAppImageBuilder, WhatsAppImageMessage> {
  constructor() {
    super();
    this.setType('image');
    this.payload.image = {};
  }

  link(link?: string) {
    this.payload.image = { link };
    return this;
  }

  caption(caption?: string) {
    this.payload.image = { caption };
    return this;
  }

  protected override validate(): void {
    super.validate();
    if (!this.payload.image?.link) {
      throw new Error('El link del mensaje de imagen es requerido');
    }
  }
}