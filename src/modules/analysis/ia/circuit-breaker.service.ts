// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  IA_CB_OPTIONS,
  type CircuitBreakerOptions,
} from './circuit-breaker.config';
import { IA_REDIS } from './ia-redis.provider';
import { safely } from './ia-safety';

/** Logical state of the IA circuit breaker. */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/** Redis keys of the breaker; absent state is interpreted as `closed`. */
export const CB_STATE_KEY = 'ia:cb:state';
export const CB_OPENED_AT_KEY = 'ia:cb:openedAt';
export const CB_OPEN_DURATION_KEY = 'ia:cb:openDuration';
export const CB_FAILURES_KEY = 'ia:cb:failures';
export const CB_WINDOW_START_KEY = 'ia:cb:windowStart';
export const CB_PROBE_KEY = 'ia:cb:probe';

/**
 * T3: Redis-backed circuit breaker around IA calls. State is shared through
 * Redis so every worker/process sees the same decision; `open` is stored in
 * `ia:cb:state` and the single half-open probe is gated by an `ia:cb:probe`
 * lock with a TTL, which also recovers from a crashed probe. Absent state (or
 * an unreachable Redis) is interpreted as `closed` — the safe default.
 */
@Injectable()
export class CircuitBreakerService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(IA_REDIS) private readonly redis: Redis,
    @Inject(IA_CB_OPTIONS) private readonly options: CircuitBreakerOptions,
  ) {
    this.logger.setContext(CircuitBreakerService.name);
  }

  /** Current state for readers (retry worker, metrics, admin). */
  async getState(): Promise<CircuitBreakerState> {
    return safely(
      this.logger,
      'closed',
      () => this.readState(),
      'Circuit breaker state read failed; treated as closed',
    );
  }

  /** Convenience for callers that only need to know if calls are blocked. */
  async isOpen(): Promise<boolean> {
    return (await this.getState()) === 'open';
  }

  /**
   * Hot-path gate: `true` means the IA call may proceed. While open and before
   * the cooldown it blocks; once the cooldown elapses it lets exactly one
   * caller through (half-open) via an atomic `SET NX` probe lock.
   */
  async beforeCall(): Promise<boolean> {
    return safely(
      this.logger,
      true,
      async () => {
        const [state, probe, openedAtRaw, durationRaw] = await this.redis.mget(
          CB_STATE_KEY,
          CB_PROBE_KEY,
          CB_OPENED_AT_KEY,
          CB_OPEN_DURATION_KEY,
        );

        if (probe) return false;
        if (state !== 'open') return true;

        const openedAt = Number(openedAtRaw);
        const duration = Number(durationRaw);
        if (!Number.isFinite(openedAt) || !Number.isFinite(duration)) {
          await this.redis.del(
            CB_STATE_KEY,
            CB_OPENED_AT_KEY,
            CB_OPEN_DURATION_KEY,
          );
          return true;
        }

        if (Date.now() - openedAt < duration) return false;

        const acquired = await this.redis.set(
          CB_PROBE_KEY,
          '1',
          'PX',
          this.probeTtlMs,
          'NX',
        );
        if (acquired === null) return false;

        this.logger.info(
          { openDurationMs: duration },
          'Circuit breaker half-open: probe allowed',
        );

        return true;
      },
      'Circuit breaker check failed; IA call allowed',
    );
  }

  /** How long a probe may hold the half-open lock before it is considered dead. */
  private get probeTtlMs(): number {
    return Math.max(this.options.openDurationMs, this.options.reopenDurationMs);
  }

  /**
   * Feeds one IA unavailability (transport failure or 5xx). A failed probe
   * reopens the breaker for the reopen duration; regular failures are counted
   * in a rolling window and trip it open once the threshold is reached inside
   * it. Failures arriving while already open never extend the cooldown.
   */
  async recordFailure(): Promise<void> {
    return safely(
      this.logger,
      undefined,
      async () => {
        const state = await this.readState();

        if (state === 'half-open') {
          await this.redis.del(CB_PROBE_KEY);
          await this.open(this.options.reopenDurationMs);
          this.logger.info(
            { reopenDurationMs: this.options.reopenDurationMs },
            'Circuit breaker reopened after a failed probe',
          );
          return;
        }

        if (state === 'open') return;

        const now = Date.now();
        const [failuresRaw, windowStartRaw] = await this.redis.mget(
          CB_FAILURES_KEY,
          CB_WINDOW_START_KEY,
        );

        const windowStart = Number(windowStartRaw);
        const withinWindow =
          Number.isFinite(windowStart) &&
          windowStart > 0 &&
          now - windowStart < this.options.failureWindowMs;

        const failures = withinWindow ? (Number(failuresRaw) || 0) + 1 : 1;
        const startedAt = withinWindow ? windowStart : now;
        const ttl = this.options.failureWindowMs * 2;

        await this.redis.set(CB_FAILURES_KEY, String(failures), 'PX', ttl);
        await this.redis.set(CB_WINDOW_START_KEY, String(startedAt), 'PX', ttl);

        if (failures >= this.options.failureThreshold) {
          await this.open(this.options.openDurationMs);
          this.logger.info(
            {
              failures,
              threshold: this.options.failureThreshold,
              openDurationMs: this.options.openDurationMs,
            },
            'Circuit breaker opened after repeated IA failures',
          );
        }
      },
      'Circuit breaker failure could not be recorded; ignored',
    );
  }

  /**
   * Records a healthy IA response: the breaker closes and the failure window
   * resets, so stale failures never trip it once the IA is answering again.
   */
  async recordSuccess(): Promise<void> {
    return safely(
      this.logger,
      undefined,
      async () => {
        const state = await this.readState();

        await this.redis.del(
          CB_STATE_KEY,
          CB_PROBE_KEY,
          CB_OPENED_AT_KEY,
          CB_OPEN_DURATION_KEY,
          CB_FAILURES_KEY,
          CB_WINDOW_START_KEY,
        );

        if (state !== 'closed') {
          this.logger.info(
            { previousState: state },
            'Circuit breaker closed after a successful call',
          );
        }
      },
      'Circuit breaker success could not be recorded; ignored',
    );
  }

  /**
   * Reads `state` + `probe` in one round-trip and maps them to the logical
   * state. The probe lock wins over the stored value, so an in-flight probe is
   * reported as `half-open`.
   */
  private async readState(): Promise<CircuitBreakerState> {
    const [state, probe] = await this.redis.mget(CB_STATE_KEY, CB_PROBE_KEY);

    if (probe) return 'half-open';
    return state === 'open' ? 'open' : 'closed';
  }

  /** Stores the `open` state plus the deadline inputs used to allow a probe. */
  private async open(durationMs: number): Promise<void> {
    const ttl = durationMs + this.options.failureWindowMs;

    await this.redis.set(CB_OPENED_AT_KEY, String(Date.now()), 'PX', ttl);
    await this.redis.set(CB_OPEN_DURATION_KEY, String(durationMs), 'PX', ttl);
    await this.redis.set(CB_STATE_KEY, 'open', 'PX', ttl);
  }
}
