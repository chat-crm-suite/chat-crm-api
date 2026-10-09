// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import {
  ENRICH_MEDIA_CONCURRENCY,
  ENRICH_MEDIA_QUEUE,
  type EnrichMediaJobData,
} from './enrich-media.queue';
import { InboundMediaEnrichmentService } from './inbound-media-enrichment.service';

/**
 * T23 worker: consumes `enrich-media` jobs off the event bus with bounded
 * concurrency. The handler only enqueues; this worker rehydrates the saved row
 * and owns the streamed download, retry budget and single attachment patch.
 * A rethrow from the enrichment (retryable fault with attempts left) is what
 * makes BullMQ schedule the exponential-backoff retry.
 */
@Processor(ENRICH_MEDIA_QUEUE, { concurrency: ENRICH_MEDIA_CONCURRENCY })
export class EnrichMediaProcessor extends WorkerHost {
  constructor(
    private readonly enrichment: InboundMediaEnrichmentService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(EnrichMediaProcessor.name);
  }

  process(job: Job<EnrichMediaJobData>): Promise<void> {
    return this.enrichment.enrichById(job.data.messageId, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EnrichMediaJobData>, error: Error): void {
    this.logger.error(
      { err: error, jobId: job.id, messageId: job.data.messageId },
      `Inbound media enrichment job ${job.id} failed`,
    );
  }
}
