// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import type { AnalysisSkipReason } from '../../../contracts/index';
import {
  CircuitBreakerService,
  type CircuitBreakerState,
} from '../ia/circuit-breaker.service';
import { IA_REDIS } from '../ia/ia-redis.provider';
import { safely } from '../ia/ia-safety';
import { SentimentRepository } from './sentiment.repository';

/** Counters reset daily: the TTL is set when a key is born, never extended. */
export const METRICS_TTL_SECONDS = 24 * 60 * 60;

/** Redis keys of the sentiment health counters and the latency samples. */
export const METRICS_KEYS = {
  completed: 'ia:metrics:completed',
  failed: 'ia:metrics:failed',
  skipped: {
    kill_switch: 'ia:metrics:skipped:kill_switch',
    circuit_breaker: 'ia:metrics:skipped:circuit_breaker',
    ia_unavailable: 'ia:metrics:skipped:ia_unavailable',
  },
  retryEnqueued: 'ia:metrics:retry_enqueued',
  latencyLast: 'ia:metrics:latency:last',
  latencySum: 'ia:metrics:latency:sum',
  latencyCount: 'ia:metrics:latency:count',
} as const;

/** JSON snapshot served by `GET /metrics`. */
export type SentimentMetricsSnapshot = {
  windowSeconds: number;
  counts: {
    completed: number;
    failed: number;
    skipped: Record<AnalysisSkipReason, number>;
    retryEnqueued: number;
  };
  iaLatencyMs: {
    last: number | null;
    avg: number | null;
    samples: number;
  };
  circuitBreaker: CircuitBreakerState;
  retryBacklog: number;
  timestamp: string;
};

/**
 * T6: operational counters for the sentiment pipeline. Every real path
 * (completed, failed, skipped per reason, retry enqueued) bumps a Redis counter
 * whose 24h TTL starts when the key is created, so the window resets daily
 * instead of sliding. Writes are best-effort: a metrics failure warns and never
 * breaks the analysis. `snapshot()` composes the counters with the circuit
 * breaker state and the retry backlog for `GET /metrics`.
 */
@Injectable()
export class SentimentMetricsService {
  constructor(
    @Inject(IA_REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly breaker: CircuitBreakerService,
    private readonly repo: SentimentRepository,
  ) {
    this.logger.setContext(SentimentMetricsService.name);
  }

  /** One analysis finished with a valid IA response and a persisted result. */
  async recordCompleted(durationMs: number): Promise<void> {
    const duration =
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;

    await safely(
      this.logger,
      undefined,
      async () => {
        await Promise.all([
          this.increment(METRICS_KEYS.completed),
          this.increment(METRICS_KEYS.latencyCount),
          this.addFloat(METRICS_KEYS.latencySum, duration),
          this.redis.set(
            METRICS_KEYS.latencyLast,
            String(duration),
            'EX',
            METRICS_TTL_SECONDS,
          ),
        ]);
      },
      'Sentiment metrics: completed count could not be recorded',
    );
  }

  /** One analysis hit a real failure (broken contract, persistence error). */
  async recordFailed(): Promise<void> {
    await safely(
      this.logger,
      undefined,
      () => this.increment(METRICS_KEYS.failed),
      'Sentiment metrics: failed count could not be recorded',
    );
  }

  /** One analysis was skipped for an availability reason. */
  async recordSkipped(reason: AnalysisSkipReason): Promise<void> {
    await safely(
      this.logger,
      undefined,
      () => this.increment(METRICS_KEYS.skipped[reason]),
      'Sentiment metrics: skip count could not be recorded',
    );
  }

  /** One skipped analysis was re-enqueued by the deferred retry worker. */
  async recordRetryEnqueued(): Promise<void> {
    await safely(
      this.logger,
      undefined,
      () => this.increment(METRICS_KEYS.retryEnqueued),
      'Sentiment metrics: retry enqueue count could not be recorded',
    );
  }

  /**
   * Read side of `GET /metrics`. Each source is independent and best-effort:
   * counters degrade to zeros when Redis is unreachable (with a warning), the
   * breaker already fails safe to `closed`, and the backlog degrades to zero
   * when MySQL cannot answer. Dependency health is `/health/ready`'s job.
   */
  async snapshot(): Promise<SentimentMetricsSnapshot> {
    const [counters, circuitBreaker, retryBacklog] = await Promise.all([
      this.readCounters(),
      this.breaker.getState(),
      this.readRetryBacklog(),
    ]);

    return {
      windowSeconds: METRICS_TTL_SECONDS,
      counts: counters.counts,
      iaLatencyMs: counters.iaLatencyMs,
      circuitBreaker,
      retryBacklog,
      timestamp: new Date().toISOString(),
    };
  }

  private async readCounters(): Promise<
    Pick<SentimentMetricsSnapshot, 'counts' | 'iaLatencyMs'>
  > {
    const empty: Pick<SentimentMetricsSnapshot, 'counts' | 'iaLatencyMs'> = {
      counts: {
        completed: 0,
        failed: 0,
        skipped: {
          kill_switch: 0,
          circuit_breaker: 0,
          ia_unavailable: 0,
        },
        retryEnqueued: 0,
      },
      iaLatencyMs: { last: null, avg: null, samples: 0 },
    };

    return safely(
      this.logger,
      empty,
      async () => {
        const [
          completed,
          failed,
          killSwitch,
          circuitBreaker,
          iaUnavailable,
          retryEnqueued,
          latencyLast,
          latencySum,
          latencyCount,
        ] = await this.redis.mget(
          METRICS_KEYS.completed,
          METRICS_KEYS.failed,
          METRICS_KEYS.skipped.kill_switch,
          METRICS_KEYS.skipped.circuit_breaker,
          METRICS_KEYS.skipped.ia_unavailable,
          METRICS_KEYS.retryEnqueued,
          METRICS_KEYS.latencyLast,
          METRICS_KEYS.latencySum,
          METRICS_KEYS.latencyCount,
        );

        const samples = toCount(latencyCount);
        const last = toOptionalNumber(latencyLast);

        return {
          counts: {
            completed: toCount(completed),
            failed: toCount(failed),
            skipped: {
              kill_switch: toCount(killSwitch),
              circuit_breaker: toCount(circuitBreaker),
              ia_unavailable: toCount(iaUnavailable),
            },
            retryEnqueued: toCount(retryEnqueued),
          },
          iaLatencyMs: {
            last,
            avg: samples > 0 ? round1(toCount(latencySum) / samples) : null,
            samples,
          },
        };
      },
      'Sentiment metrics: counters read failed; reporting zeros',
    );
  }

  private async readRetryBacklog(): Promise<number> {
    return safely(
      this.logger,
      0,
      () => this.repo.countPendingRetries(),
      'Sentiment metrics: retry backlog read failed; reporting zero',
    );
  }

  /**
   * Counter birth: `SET NX` gives the key its 24h TTL only once, so later
   * increments keep the original deadline (daily reset, not a sliding window).
   */
  private async increment(key: string): Promise<void> {
    await this.redis.set(key, '0', 'EX', METRICS_TTL_SECONDS, 'NX');
    await this.redis.incr(key);
  }

  private async addFloat(key: string, value: number): Promise<void> {
    await this.redis.set(key, '0', 'EX', METRICS_TTL_SECONDS, 'NX');
    await this.redis.incrbyfloat(key, value);
  }
}

function toCount(value: string | null | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function toOptionalNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
