// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ChannelStatusReportedEvent } from './events/channel-status-reported.event';
import { SpendService } from './spend.service';

/** Records provider cost reports; never breaks the status pipeline. */
@EventsHandler(ChannelStatusReportedEvent)
export class ChannelStatusReportedHandler
  implements IEventHandler<ChannelStatusReportedEvent>
{
  constructor(
    private readonly spend: SpendService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChannelStatusReportedHandler.name);
  }

  async handle(event: ChannelStatusReportedEvent): Promise<void> {
    try {
      await this.spend.recordReport(event);
    } catch (error) {
      this.logger.warn(
        { messageId: event.messageId, error: String(error) },
        'Channel charge could not be recorded',
      );
    }
  }
}
