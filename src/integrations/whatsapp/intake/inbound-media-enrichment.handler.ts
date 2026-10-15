// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InjectQueue } from '@nestjs/bullmq';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { MessageSavedEvent } from '@modules/conversations/events/message-saved.event';
import {
  ENRICH_MEDIA_JOB,
  ENRICH_MEDIA_QUEUE,
  type EnrichMediaJobData,
  enrichMediaJobOptions,
} from './enrich-media.queue';

/**
 * T23 trigger: a saved message only enqueues one `enrich-media` job and the
 * handler returns — the worker owns the download with its retry budget, so
 * heavy media can never block the message-saved flow. An enqueue failure must
 * never bubble into the event bus (the row is already durable).
 */
@EventsHandler(MessageSavedEvent)
export class InboundMediaEnrichmentHandler
  implements IEventHandler<MessageSavedEvent>
{
  constructor(
    @InjectQueue(ENRICH_MEDIA_QUEUE)
    private readonly queue: Queue<EnrichMediaJobData>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMediaEnrichmentHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    try {
      await this.queue.add(
        ENRICH_MEDIA_JOB,
        { messageId: message.id },
        enrichMediaJobOptions(),
      );
    } catch (error: unknown) {
      this.logger.error(
        { error, messageId: message?.id },
        'Failed to enqueue inbound media enrichment',
      );
    }
  }
}
