// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { AnalyticsSignalEvent } from '../analytics/events/analytics.events';
import { MessageSavedEvent } from '../conversations/events/message-saved.event';
import { CasesService } from './cases.service';

/**
 * Channel-agnostic: every saved message (webhook inbound or agent send)
 * flows through `MessageSavedEvent`, which drives the case lifecycle. Never
 * throws: a metrics failure must not break the message pipeline.
 */
@EventsHandler(MessageSavedEvent)
export class CaseMessageSavedHandler implements IEventHandler<MessageSavedEvent> {
  constructor(
    private readonly cases: CasesService,
    private readonly eventBus: EventBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaseMessageSavedHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    try {
      const touched =
        message.senderType === 'customer'
          ? await this.cases.recordInbound(message)
          : await this.cases.recordOutbound(message);

      if (touched) {
        this.eventBus.publish(
          new AnalyticsSignalEvent(touched.companyId, ['live', 'cases']),
        );
      }
    } catch (error) {
      this.logger.warn(
        { messageId: message.id, error: String(error) },
        'Case lifecycle update failed',
      );
    }
  }
}
