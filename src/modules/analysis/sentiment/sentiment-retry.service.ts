// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { CircuitBreakerService } from '../ia/circuit-breaker.service';
import { KillSwitchService } from '../ia/kill-switch.service';
import { SENTIMENT_JOB, SENTIMENT_QUEUE } from './sentiment.constants';
import { SentimentMetricsService } from './sentiment-metrics.service';
import {
  isRetryableSkipReason,
  retryDelayMs,
  SENTIMENT_RETRY_BATCH_SIZE,
} from './sentiment-retry.policy';
import { SentimentRepository } from './sentiment.repository';
import type { SentimentPayload } from './sentiment.type';

/** What one scan did; `due` counts the batch and `enqueued` the attempts sent. */
export type RetryRunSummary = {
  due: number;
  enqueued: number;
};

/**
 * T4: deferred retry of skipped analyses. One scan looks for due retryable
 * skips (real unavailability only) and re-enqueues them into the sentiment
 * queue with their `analysisId`, so the processor reuses the same analysis
 * row. The whole run is gated by the kill switch (off = no operation at all)
 * and the circuit breaker (`open` = the IA is still down); each attempt is
 * job-id deduplicated and the row's `retryCount`/`nextRetryAt` move forward
 * with the 5m → 24h backoff, giving up after 8 attempts.
 */
@Injectable()
export class SentimentRetryService {
  constructor(
    private readonly repo: SentimentRepository,
    @InjectQueue(SENTIMENT_QUEUE)
    private readonly queue: Queue<SentimentPayload>,
    private readonly logger: PinoLogger,
    private readonly killSwitch: KillSwitchService,
    private readonly breaker: CircuitBreakerService,
    private readonly metrics: SentimentMetricsService,
  ) {
    this.logger.setContext(SentimentRetryService.name);
  }

  async runOnce(now = new Date()): Promise<RetryRunSummary> {
    if (!(await this.killSwitch.isEnabled())) {
      this.logger.debug('Retry scan skipped: kill switch off');

      return { due: 0, enqueued: 0 };
    }

    if (await this.breaker.isOpen()) {
      this.logger.debug('Retry scan skipped: circuit breaker open');

      return { due: 0, enqueued: 0 };
    }

    const due = await this.repo.findDueRetries(SENTIMENT_RETRY_BATCH_SIZE, now);
    let enqueued = 0;

    for (const analysis of due) {
      // The query already filters these, but the worker is the last guard
      // before the IA: a manual skip, a hard failure or an exhausted analysis
      // must never be retried, whatever the caller hands over.
      if (
        analysis.status !== 'skipped' ||
        !isRetryableSkipReason(analysis.skipReason) ||
        !analysis.messageId
      ) {
        continue;
      }

      const attempt = analysis.retryCount + 1;
      if (retryDelayMs(attempt) === null) continue;

      const nextDelay = retryDelayMs(attempt + 1);

      try {
        await this.queue.add(
          SENTIMENT_JOB,
          {
            messageId: analysis.messageId,
            conversationId: analysis.conversationId,
            analysisId: analysis.id,
          },
          // Deterministic per attempt so overlapping scans can never enqueue
          // the same retry twice. `|` keeps it readable: BullMQ forbids `:`.
          { jobId: `retry|${analysis.id}|${attempt}` },
        );

        await this.repo.scheduleRetryAttempt(
          analysis.id,
          analysis.retryCount,
          nextDelay === null ? null : new Date(now.getTime() + nextDelay),
        );
        enqueued += 1;

        // T6: only attempts that really reached the queue feed `/metrics`.
        await this.metrics.recordRetryEnqueued();

        this.logger.info(
          {
            analysisId: analysis.id,
            messageId: analysis.messageId,
            conversationId: analysis.conversationId,
            reason: analysis.skipReason,
            retryCount: attempt,
          },
          'Skipped sentiment analysis re-enqueued for retry',
        );
      } catch (err: unknown) {
        this.logger.warn(
          { err, analysisId: analysis.id },
          'Failed to re-enqueue skipped sentiment analysis',
        );
      }
    }

    return { due: due.length, enqueued };
  }
}
