// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Message } from '../../message/entities/message.entity';

export class MessageSavedEvent {
  constructor(
    public readonly message: Message,
    /** Empresa del origen del mensaje (canal de WhatsApp o socket), si se conoce. */
    public readonly companyId?: string,
  ) {}
}
