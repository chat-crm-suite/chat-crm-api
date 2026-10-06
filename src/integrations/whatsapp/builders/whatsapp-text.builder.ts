// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { WhatsAppTextMessage } from '../interfaces/whatsapp-message.interface';
import { WhatsAppBaseBuilder } from './whatsapp-base.builder';

/**
 * Builder for text
 *
 * @example
 *   const payload = new WhatsAppTextBuilder()
 *     .to('+51999999999')
 *     .body('Hola mundo!')
 *     .previewUrl(true)
 *     .build();
 */
export class WhatsAppTextBuilder extends WhatsAppBaseBuilder<WhatsAppTextBuilder, WhatsAppTextMessage> {
  constructor() {
    super();
    this.setType('text');
    this.payload.text = { body: '' };
  }

  /**
   * Cuerpo del mensaje de texto
   */
  body(text: string): WhatsAppTextBuilder {
    if (!text || text.trim().length === 0) {
      throw new Error('El cuerpo del mensaje no puede estar vacío');
    }
    this.payload.text!.body = text;
    return this;
  }

  /**
   * Habilita la vista previa de URLs dentro del mensaje
   */
  previewUrl(enable = true): WhatsAppTextBuilder {
    this.payload.text!.preview_url = enable;
    return this;
  }

  protected override validate(): void {
    super.validate();
    if (!this.payload.text?.body) {
      throw new Error('El cuerpo del mensaje de texto es requerido');
    }
  }
}