// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Redis } from 'ioredis';

import {
  CIRCUIT_BREAKER_DEFAULTS,
  readCircuitBreakerOptions,
  type CircuitBreakerOptions,
} from './circuit-breaker.config';
import { CircuitBreakerService } from './circuit-breaker.service';

type Entry = { value: string; expiresAt: number | null };

/**
 * In-memory stand-in for the shared Redis state. It only implements the
 * commands the breaker uses, honouring `PX`/`NX` semantics and the fake clock,
 * so the state machine is exercised through its real code path.
 */
class FakeRedis {
  private readonly store = new Map<string, Entry>();

  private read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.read(key));
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((key) => this.read(key)));
  }

  set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    const pxIndex = args.indexOf('PX');
    const ttlMs = pxIndex >= 0 ? Number(args[pxIndex + 1]) : null;
    const nx = args.includes('NX');

    if (nx && this.read(key) !== null) return Promise.resolve(null);

    this.store.set(key, {
      value,
      expiresAt: ttlMs === null ? null : Date.now() + ttlMs,
    });

    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }
}

describe('readCircuitBreakerOptions (T3)', () => {
  it('uses the spec defaults when the environment is empty', () => {
    expect(readCircuitBreakerOptions({})).toEqual({
      failureThreshold: 5,
      failureWindowMs: 60_000,
      openDurationMs: 30_000,
      reopenDurationMs: 60_000,
    });
  });

  it('reads every tunable from the environment', () => {
    expect(
      readCircuitBreakerOptions({
        IA_CB_FAILURE_THRESHOLD: '3',
        IA_CB_FAILURE_WINDOW_MS: '120000',
        IA_CB_OPEN_DURATION_MS: '5000',
        IA_CB_REOPEN_DURATION_MS: '9000',
      }),
    ).toEqual({
      failureThreshold: 3,
      failureWindowMs: 120_000,
      openDurationMs: 5_000,
      reopenDurationMs: 9_000,
    });
  });

  it('falls back to the defaults on invalid values', () => {
    expect(
      readCircuitBreakerOptions({
        IA_CB_FAILURE_THRESHOLD: 'nope',
        IA_CB_FAILURE_WINDOW_MS: '0',
        IA_CB_OPEN_DURATION_MS: '-5',
      }),
    ).toEqual(CIRCUIT_BREAKER_DEFAULTS);
  });
});

describe('CircuitBreakerService (T3)', () => {
  let redis: FakeRedis;
  let service: CircuitBreakerService;

  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const build = (overrides: Partial<CircuitBreakerOptions> = {}) => {
    service = new CircuitBreakerService(
      logger as never,
      redis as unknown as Redis,
      { ...CIRCUIT_BREAKER_DEFAULTS, ...overrides },
    );
    return service;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-07T00:00:00.000Z'));
    jest.clearAllMocks();
    redis = new FakeRedis();
    build();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('treats an absent state as closed and allows calls', async () => {
    await expect(service.getState()).resolves.toBe('closed');
    await expect(service.isOpen()).resolves.toBe(false);
    await expect(service.beforeCall()).resolves.toBe(true);
  });

  it('opens at the failure threshold and not before', async () => {
    for (let failure = 0; failure < 4; failure += 1) {
      await service.recordFailure();
    }

    await expect(service.getState()).resolves.toBe('closed');
    await expect(service.beforeCall()).resolves.toBe(true);

    await service.recordFailure();

    await expect(service.getState()).resolves.toBe('open');
    await expect(service.isOpen()).resolves.toBe(true);
    await expect(service.beforeCall()).resolves.toBe(false);
    expect(logger.info).toHaveBeenCalled();
  });

  it('only counts failures inside the window', async () => {
    for (let failure = 0; failure < 4; failure += 1) {
      await service.recordFailure();
    }

    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.failureWindowMs + 1);
    await service.recordFailure();

    await expect(service.getState()).resolves.toBe('closed');

    for (let failure = 0; failure < 3; failure += 1) {
      await service.recordFailure();
    }
    await expect(service.getState()).resolves.toBe('closed');

    await service.recordFailure();
    await expect(service.getState()).resolves.toBe('open');
  });

  const openBreaker = async () => {
    for (
      let failure = 0;
      failure < CIRCUIT_BREAKER_DEFAULTS.failureThreshold;
      failure += 1
    ) {
      await service.recordFailure();
    }
    await expect(service.getState()).resolves.toBe('open');
  };

  it('allows exactly one probe after the cooldown', async () => {
    await openBreaker();

    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.openDurationMs - 1);
    await expect(service.beforeCall()).resolves.toBe(false);
    await expect(service.getState()).resolves.toBe('open');

    jest.advanceTimersByTime(1);
    await expect(service.beforeCall()).resolves.toBe(true);
    await expect(service.getState()).resolves.toBe('half-open');

    await expect(service.beforeCall()).resolves.toBe(false);
  });

  it('closes on a successful probe and resets the failure window', async () => {
    await openBreaker();
    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.openDurationMs);
    await expect(service.beforeCall()).resolves.toBe(true);

    await service.recordSuccess();

    await expect(service.getState()).resolves.toBe('closed');
    await expect(service.beforeCall()).resolves.toBe(true);
    expect(logger.info).toHaveBeenCalled();

    for (let failure = 0; failure < 4; failure += 1) {
      await service.recordFailure();
    }
    await expect(service.getState()).resolves.toBe('closed');
  });

  it('reopens for the reopen duration when the probe fails', async () => {
    await openBreaker();
    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.openDurationMs);
    await expect(service.beforeCall()).resolves.toBe(true);

    await service.recordFailure();

    await expect(service.getState()).resolves.toBe('open');

    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.reopenDurationMs - 1);
    await expect(service.beforeCall()).resolves.toBe(false);

    jest.advanceTimersByTime(1);
    await expect(service.beforeCall()).resolves.toBe(true);
  });

  it('honours the configured reopen duration and releases the probe lock', async () => {
    build({ openDurationMs: 30_000, reopenDurationMs: 10_000 });
    await openBreaker();
    jest.advanceTimersByTime(30_000);
    await expect(service.beforeCall()).resolves.toBe(true);

    await service.recordFailure();

    jest.advanceTimersByTime(9_999);
    await expect(service.beforeCall()).resolves.toBe(false);

    jest.advanceTimersByTime(1);
    await expect(service.beforeCall()).resolves.toBe(true);
  });

  it('does not extend an already open breaker with late failures', async () => {
    await openBreaker();

    jest.advanceTimersByTime(10_000);
    await service.recordFailure();

    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.openDurationMs - 10_000);
    await expect(service.beforeCall()).resolves.toBe(true);
  });

  it('recovers the half-open lock if a probe never reports back', async () => {
    await openBreaker();
    jest.advanceTimersByTime(CIRCUIT_BREAKER_DEFAULTS.openDurationMs);
    await expect(service.beforeCall()).resolves.toBe(true);

    jest.advanceTimersByTime(
      Math.max(
        CIRCUIT_BREAKER_DEFAULTS.openDurationMs,
        CIRCUIT_BREAKER_DEFAULTS.reopenDurationMs,
      ),
    );

    await expect(service.beforeCall()).resolves.toBe(true);
  });
});

/**
 * T3: Redis itself is a shared dependency that can go away. The breaker must
 * never take the analysis pipeline down with it: every read falls back to
 * `closed` and every write is dropped, with a warning instead of an error.
 */
describe('CircuitBreakerService Redis outages (T3)', () => {
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const failingRedis = {
    get: jest.fn(),
    mget: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  let service: CircuitBreakerService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of Object.values(failingRedis)) {
      method.mockRejectedValue(new Error('redis down'));
    }

    service = new CircuitBreakerService(
      logger as never,
      failingRedis as never,
      CIRCUIT_BREAKER_DEFAULTS,
    );
  });

  it('fails open and warns, never erroring', async () => {
    await expect(service.getState()).resolves.toBe('closed');
    await expect(service.beforeCall()).resolves.toBe(true);
    await expect(service.recordFailure()).resolves.toBeUndefined();
    await expect(service.recordSuccess()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
