// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import {
  SENTIMENT_RETRY_INTERVAL_MS,
  SENTIMENT_RETRY_QUEUE,
  SENTIMENT_RETRY_SCAN_JOB,
  SENTIMENT_RETRY_SCHEDULER_ID,
} from './sentiment-retry.policy';
import {
  SentimentRetryService,
  type RetryRunSummary,
} from './sentiment-retry.service';

/**
 * T4: periodic trigger of the deferred-retry scan. A BullMQ job scheduler on
 * the dedicated `sentiment-retry` queue produces one job every 5 minutes;
 * every job runs a single bounded scan. The schedule lives in Redis, so it
 * survives restarts and is registered idempotently on bootstrap.
 */
@Processor(SENTIMENT_RETRY_QUEUE)
export class SentimentRetryProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly retry: SentimentRetryService,
    private readonly logger: PinoLogger,
    @InjectQueue(SENTIMENT_RETRY_QUEUE)
    private readonly queue: Queue,
  ) {
    super();
    this.logger.setContext(SentimentRetryProcessor.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SENTIMENT_RETRY_SCHEDULER_ID,
        { every: SENTIMENT_RETRY_INTERVAL_MS },
        { name: SENTIMENT_RETRY_SCAN_JOB },
      );
    } catch (err: unknown) {
      this.logger.warn(
        { err },
        'Failed to register the skipped-analyses retry scan',
      );
    }
  }

  process(_job: Job): Promise<RetryRunSummary> {
    return this.retry.runOnce();
  }
}
