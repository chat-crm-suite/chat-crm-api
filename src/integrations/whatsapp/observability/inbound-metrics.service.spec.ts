// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Redis } from 'ioredis';

import type { WhatsAppIntakeService } from '../intake/whatsapp-intake.service';
import type { Queue } from 'bullmq';
import {
  INBOUND_METRICS_KEYS,
  INBOUND_METRICS_TTL_SECONDS,
  InboundMetricsService,
} from './inbound-metrics.service';

type Hash = Map<string, number>;

/**
 * Minimal in-memory stand-in for the Redis hash commands the inbound metrics
 * use (`HSETNX`, `HINCRBY`, `EXPIRE`, `TTL`, `HGETALL`), so the counters and
 * their daily window are exercised through the real code path.
 */
class FakeRedis {
  readonly store = new Map<string, Map<string, number>>();
  readonly expiries = new Map<string, number>();

  private live(key: string): Hash | undefined {
    const expiresAt = this.expiries.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.store.delete(key);
      this.expiries.delete(key);
      return undefined;
    }
    return this.store.get(key);
  }

  hsetnx(key: string, field: string, value: string): Promise<number> {
    const hash = this.live(key) ?? this.store.set(key, new Map()).get(key)!;
    if (hash.has(field)) return Promise.resolve(0);
    hash.set(field, Number(value));
    return Promise.resolve(1);
  }

  hincrby(key: string, field: string, by: number): Promise<number> {
    const hash = this.live(key) ?? new Map<string, number>();
    const next = (hash.get(field) ?? 0) + by;
    hash.set(field, next);
    this.store.set(key, hash);
    return Promise.resolve(next);
  }

  expire(key: string, seconds: number): Promise<number> {
    if (!this.live(key)) return Promise.resolve(0);
    this.expiries.set(key, Date.now() + seconds * 1_000);
    return Promise.resolve(1);
  }

  ttl(key: string): Promise<number> {
    if (!this.live(key)) return Promise.resolve(-2);
    const expiresAt = this.expiries.get(key);
    if (expiresAt === undefined) return Promise.resolve(-1);
    return Promise.resolve(Math.ceil((expiresAt - Date.now()) / 1_000));
  }

  hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.live(key);
    if (!hash) return Promise.resolve({});
    return Promise.resolve(Object.fromEntries([...hash].map(([f, v]) => [f, String(v)])));
  }
}

function build() {
  const redis = new FakeRedis();
  const logger = { warn: jest.fn(), error: jest.fn(), setContext: jest.fn() };
  const intake = { countPending: jest.fn().mockResolvedValue(7) };
  const queue = {
    getJobCounts: jest
      .fn()
      .mockResolvedValue({ waiting: 2, delayed: 1, active: 3 }),
  };
  const service = new InboundMetricsService(
    redis as unknown as Redis,
    logger as never,
    intake as unknown as WhatsAppIntakeService,
    queue as unknown as Queue,
  );

  return { service, redis, logger, intake, queue };
}

describe('InboundMetricsService (ticket #24)', () => {
  it('accumulates received, discarded (by type and reason) and media counters', async () => {
    const { service } = build();

    await service.recordReceived('text');
    await service.recordReceived('text');
    await service.recordReceived('image');
    await service.recordDiscarded('order', 'unknown-type');
    await service.recordDiscarded('text', 'missing-text-body');
    await service.recordDiscarded('order', 'unknown-type');
    await service.recordMediaEnriched('image');
    await service.recordMediaFailed('video');

    await expect(service.snapshot()).resolves.toMatchObject({
      counts: {
        received: 3,
        receivedByType: { text: 2, image: 1 },
        discarded: 3,
        discardedByType: { order: 2, text: 1 },
        discardedByReason: { 'unknown-type': 2, 'missing-text-body': 1 },
        mediaEnriched: 1,
        mediaFailed: 1,
      },
    });
  });

  it('exposes the queue depth and intake backlog gauges', async () => {
    const { service, queue, intake } = build();

    const snapshot = await service.snapshot();

    expect(queue.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'delayed',
      'active',
    );
    expect(intake.countPending).toHaveBeenCalled();
    expect(snapshot.gauges).toEqual({ queueDepth: 6, intakeBacklog: 7 });
  });

  it('labels no counter with a message or phone identifier', async () => {
    const { service, redis } = build();

    await service.recordReceived('text');
    await service.recordDiscarded('order', 'unknown-type');
    await service.recordMediaEnriched('image');
    await service.recordMediaFailed('video');

    const keys = [...redis.store.keys()];
    expect(keys.sort()).toEqual(
      [
        INBOUND_METRICS_KEYS.received,
        INBOUND_METRICS_KEYS.discardedByType,
        INBOUND_METRICS_KEYS.discardedByReason,
        INBOUND_METRICS_KEYS.mediaEnriched,
        INBOUND_METRICS_KEYS.mediaFailed,
      ].sort(),
    );
    for (const fields of redis.store.values()) {
      for (const field of fields.keys()) {
        expect(field).not.toMatch(/wamid|msg-|media-|1555|phone/i);
      }
    }
    expect(keys.join(' ')).not.toMatch(/wamid|1555|phone/i);
  });

  it('gives a counter its daily TTL once, without sliding it', async () => {
    const { service, redis } = build();

    await service.recordReceived('text');
    const first = await redis.ttl(INBOUND_METRICS_KEYS.received);
    await service.recordReceived('text');

    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(INBOUND_METRICS_TTL_SECONDS);
    const second = await redis.ttl(INBOUND_METRICS_KEYS.received);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(first);
  });

  it('degrades to empty counters when the store is unreachable', async () => {
    const { service, logger } = build();
    jest
      .spyOn(FakeRedis.prototype, 'hsetnx')
      .mockRejectedValue(new Error('redis down'));

    // A write failure must never bubble (best-effort counters).
    await expect(service.recordReceived('text')).resolves.toBeUndefined();
    await expect(service.snapshot()).resolves.toMatchObject({
      counts: { received: 0, discarded: 0, mediaEnriched: 0, mediaFailed: 0 },
    });
    expect(logger.warn).toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
