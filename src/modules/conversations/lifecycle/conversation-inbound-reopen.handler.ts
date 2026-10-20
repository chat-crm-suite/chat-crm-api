// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MessageSavedEvent } from '../events/message-saved.event';
import { ConversationLifecycleService } from './conversation-lifecycle.service';

/**
 * Channel-agnostic: a saved customer message turns a `pending` or `closed`
 * conversation back into `open` (the case reopens on its own in
 * `CasesService.recordInbound`). Outbound messages never touch the status.
 * Never throws: the message pipeline must not break on it.
 */
@EventsHandler(MessageSavedEvent)
export class ConversationInboundReopenHandler implements IEventHandler<MessageSavedEvent> {
  constructor(
    private readonly lifecycle: ConversationLifecycleService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationInboundReopenHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    if (message.senderType !== 'customer') return;

    try {
      await this.lifecycle.reopenOnInbound(message.conversationId);
    } catch (error) {
      this.logger.warn(
        { conversationId: message.conversationId, error: String(error) },
        'Inbound reopen failed',
      );
    }
  }
}
