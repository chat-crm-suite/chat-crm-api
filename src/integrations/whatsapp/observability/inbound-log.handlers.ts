// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';

/**
 * Ticket #24 log consumers per domain fact. Each one is the single fixed point
 * that turns a fact into a correlated line (message/attachment/media ids, type,
 * reason) and never throws into the event bus: a log sink failure must never
 * break the already-durable inbound flow.
 */

@EventsHandler(InboundMessageDiscardedEvent)
export class InboundDiscardLogHandler
  implements IEventHandler<InboundMessageDiscardedEvent>
{
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(InboundDiscardLogHandler.name);
  }

  handle(event: InboundMessageDiscardedEvent): void {
    try {
      this.logger.warn(
        {
          messageId: event.messageId,
          type: event.type,
          reason: event.reason,
        },
        'Inbound message discarded',
      );
    } catch {
      // A log handler never throws into the event bus.
    }
  }
}

@EventsHandler(InboundMediaEnrichedEvent)
export class InboundMediaEnrichedLogHandler
  implements IEventHandler<InboundMediaEnrichedEvent>
{
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(InboundMediaEnrichedLogHandler.name);
  }

  handle(event: InboundMediaEnrichedEvent): void {
    try {
      this.logger.debug(
        { ...event.ref },
        'Inbound media enriched',
      );
    } catch {
      // A log handler never throws into the event bus.
    }
  }
}

@EventsHandler(InboundMediaFailedEvent)
export class InboundMediaFailedLogHandler
  implements IEventHandler<InboundMediaFailedEvent>
{
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(InboundMediaFailedLogHandler.name);
  }

  handle(event: InboundMediaFailedEvent): void {
    const fields = {
      ...event.ref,
      retryable: event.retryable,
    };

    try {
      // A retryable transport fault whose budget ran out is handled
      // degradation (warn); a terminal fault (oversized/expired media) is a
      // real failure worth investigating (error).
      if (event.retryable) {
        this.logger.warn(fields, 'Inbound media enrichment failed after retries');
        return;
      }

      this.logger.error(
        { ...fields, err: event.error },
        'Inbound media enrichment failed',
      );
    } catch {
      // A log handler never throws into the event bus.
    }
  }
}
