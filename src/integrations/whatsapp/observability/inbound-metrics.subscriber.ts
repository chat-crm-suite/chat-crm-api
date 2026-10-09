// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import { InboundMessageReceivedEvent } from '../events/inbound-message-received.event';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';
import { InboundMetricsService } from './inbound-metrics.service';

/**
 * Ticket #24 metrics subscriber: one handler per domain fact forwards the
 * bounded label (`type`, and `reason` for discards) to the recorder. The
 * high-cardinality correlation ids the facts carry stay out of the metrics.
 * A metrics failure is best-effort: it warns and never throws into the event
 * bus.
 */

@EventsHandler(InboundMessageReceivedEvent)
export class InboundReceivedMetricsHandler
  implements IEventHandler<InboundMessageReceivedEvent>
{
  constructor(
    private readonly metrics: InboundMetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundReceivedMetricsHandler.name);
  }

  async handle(event: InboundMessageReceivedEvent): Promise<void> {
    try {
      await this.metrics.recordReceived(event.type);
    } catch (error: unknown) {
      this.logger.warn(
        { error, type: event.type },
        'Inbound metrics: received count failed',
      );
    }
  }
}

@EventsHandler(InboundMessageDiscardedEvent)
export class InboundDiscardedMetricsHandler
  implements IEventHandler<InboundMessageDiscardedEvent>
{
  constructor(
    private readonly metrics: InboundMetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundDiscardedMetricsHandler.name);
  }

  async handle(event: InboundMessageDiscardedEvent): Promise<void> {
    try {
      await this.metrics.recordDiscarded(event.type, event.reason);
    } catch (error: unknown) {
      this.logger.warn(
        { error, type: event.type, reason: event.reason },
        'Inbound metrics: discard count failed',
      );
    }
  }
}

@EventsHandler(InboundMediaEnrichedEvent)
export class InboundMediaEnrichedMetricsHandler
  implements IEventHandler<InboundMediaEnrichedEvent>
{
  constructor(
    private readonly metrics: InboundMetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMediaEnrichedMetricsHandler.name);
  }

  async handle(event: InboundMediaEnrichedEvent): Promise<void> {
    try {
      await this.metrics.recordMediaEnriched(event.type);
    } catch (error: unknown) {
      this.logger.warn(
        { error, type: event.type },
        'Inbound metrics: enriched media count failed',
      );
    }
  }
}

@EventsHandler(InboundMediaFailedEvent)
export class InboundMediaFailedMetricsHandler
  implements IEventHandler<InboundMediaFailedEvent>
{
  constructor(
    private readonly metrics: InboundMetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMediaFailedMetricsHandler.name);
  }

  async handle(event: InboundMediaFailedEvent): Promise<void> {
    try {
      await this.metrics.recordMediaFailed(event.type);
    } catch (error: unknown) {
      this.logger.warn(
        { error, type: event.type },
        'Inbound metrics: failed media count failed',
      );
    }
  }
}
