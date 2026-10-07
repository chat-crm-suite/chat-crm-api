// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Redis } from 'ioredis';

import type { CircuitBreakerService } from '../ia/circuit-breaker.service';
import {
  METRICS_KEYS,
  METRICS_TTL_SECONDS,
  SentimentMetricsService,
} from './sentiment-metrics.service';
import type { SentimentRepository } from './sentiment.repository';

type Entry = { value: string; expiresAt: number | null };

/**
 * In-memory stand-in for the shared Redis state. It only implements the
 * commands the metrics service uses (`SET NX EX`, `INCR`, `INCRBYFLOAT`,
 * `MGET`) honouring TTL and NX semantics, so counters and their 24h window are
 * exercised through the real code path.
 */
class FakeRedis {
  readonly store = new Map<string, Entry>();

  private read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    const exIndex = args.indexOf('EX');
    const ttlSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : null;
    const nx = args.includes('NX');

    if (nx && this.read(key) !== null) return Promise.resolve(null);

    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === null ? null : Date.now() + ttlSeconds * 1_000,
    });

    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    const value = Number(this.read(key) ?? '0') + 1;
    this.store.set(key, {
      value: String(value),
      expiresAt: this.store.get(key)?.expiresAt ?? null,
    });

    return Promise.resolve(value);
  }

  incrbyfloat(key: string, by: number): Promise<string> {
    const value = Number(this.read(key) ?? '0') + by;
    this.store.set(key, {
      value: String(value),
      expiresAt: this.store.get(key)?.expiresAt ?? null,
    });

    return Promise.resolve(String(value));
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((key) => this.read(key)));
  }

  /** Test helper: remaining TTL in seconds, `null` when the key has none. */
  ttlSeconds(key: string): number | null {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt === null) return null;

    return Math.round((entry.expiresAt - Date.now()) / 1_000);
  }
}

/**
 * T6: `/metrics` counters live in Redis with a 24h window (daily reset) and
 * increment on the real analysis paths; the snapshot adds the breaker state and
 * the retry backlog. The endpoint is best-effort: a Redis outage degrades to
 * zeros with a warning, never to a broken analysis path.
 */
describe('SentimentMetricsService (T6)', () => {
  let redis: FakeRedis;
  let service: SentimentMetricsService;
  let getState: jest.Mock;
  let countPendingRetries: jest.Mock;

  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const build = () => {
    service = new SentimentMetricsService(
      redis as unknown as Redis,
      logger as never,
      { getState } as unknown as CircuitBreakerService,
      { countPendingRetries } as unknown as SentimentRepository,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new FakeRedis();
    getState = jest.fn().mockResolvedValue('closed');
    countPendingRetries = jest.fn().mockResolvedValue(0);
    build();
  });

  it('starts empty: zeroed counters, no latency samples, breaker and backlog from their sources', async () => {
    getState.mockResolvedValue('open');
    countPendingRetries.mockResolvedValue(7);

    const { timestamp, ...snapshot } = await service.snapshot();

    expect(snapshot).toEqual({
      windowSeconds: METRICS_TTL_SECONDS,
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
      circuitBreaker: 'open',
      retryBacklog: 7,
    });
    expect(typeof timestamp).toBe('string');
    expect(countPendingRetries).toHaveBeenCalledTimes(1);
  });

  it('counts completed analyses and samples their IA latency', async () => {
    await service.recordCompleted(120);
    await service.recordCompleted(80);

    const snapshot = await service.snapshot();

    expect(snapshot.counts.completed).toBe(2);
    expect(snapshot.iaLatencyMs).toEqual({ last: 80, avg: 100, samples: 2 });
  });

  it('counts failed analyses', async () => {
    await service.recordFailed();

    await expect(service.snapshot()).resolves.toMatchObject({
      counts: { failed: 1, completed: 0 },
    });
  });

  it.each(['kill_switch', 'circuit_breaker', 'ia_unavailable'] as const)(
    'counts skipped analyses per reason (%s)',
    async (reason) => {
      await service.recordSkipped(reason);

      const { counts } = await service.snapshot();
      expect(counts.skipped[reason]).toBe(1);
      expect(
        Object.entries(counts.skipped)
          .filter(([key]) => key !== reason)
          .map(([, value]) => value),
      ).toEqual([0, 0]);
    },
  );

  it('counts retry enqueues', async () => {
    await service.recordRetryEnqueued();

    await expect(service.snapshot()).resolves.toMatchObject({
      counts: { retryEnqueued: 1 },
    });
  });

  it('gives every counter a 24h TTL that later increments never extend', async () => {
    jest.useFakeTimers();
    try {
      await service.recordCompleted(10);

      const ttlAfterFirst = redis.ttlSeconds(METRICS_KEYS.completed);
      expect(ttlAfterFirst).toBe(METRICS_TTL_SECONDS);

      jest.advanceTimersByTime(60 * 60_000); // one hour later
      await service.recordCompleted(20);

      const ttlAfterSecond = redis.ttlSeconds(METRICS_KEYS.completed);
      expect(ttlAfterSecond).toBe(METRICS_TTL_SECONDS - 3_600);
      expect(redis.store.get(METRICS_KEYS.completed)?.value).toBe('2');
    } finally {
      jest.useRealTimers();
    }
  });

  it('resets the counters once the 24h window expires', async () => {
    jest.useFakeTimers();
    try {
      await service.recordFailed();

      jest.advanceTimersByTime(METRICS_TTL_SECONDS * 1_000);

      await expect(service.snapshot()).resolves.toMatchObject({
        counts: { failed: 0 },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('never breaks the caller when a counter write fails, warning instead', async () => {
    jest.spyOn(redis, 'incr').mockRejectedValue(new Error('redis down'));

    await expect(service.recordCompleted(10)).resolves.toBeUndefined();
    await expect(service.recordFailed()).resolves.toBeUndefined();
    await expect(
      service.recordSkipped('ia_unavailable'),
    ).resolves.toBeUndefined();
    await expect(service.recordRetryEnqueued()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('degrades the snapshot to zeros when Redis cannot be read', async () => {
    await service.recordFailed();
    jest.spyOn(redis, 'mget').mockRejectedValue(new Error('redis down'));

    await expect(service.snapshot()).resolves.toMatchObject({
      counts: {
        completed: 0,
        failed: 0,
        skipped: { kill_switch: 0, circuit_breaker: 0, ia_unavailable: 0 },
        retryEnqueued: 0,
      },
      iaLatencyMs: { last: null, avg: null, samples: 0 },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('degrades the retry backlog to zero when the count fails', async () => {
    countPendingRetries.mockRejectedValue(new Error('db down'));

    await expect(service.snapshot()).resolves.toMatchObject({
      retryBacklog: 0,
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
