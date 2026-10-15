// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** DI token of the circuit breaker tunables resolved once from the environment. */
export const IA_CB_OPTIONS = 'IA_CB_OPTIONS';

export type CircuitBreakerOptions = {
  /** Failures within the window that trip the breaker open. */
  failureThreshold: number;
  /** Rolling window in which the failures are counted. */
  failureWindowMs: number;
  /** Cooldown after tripping from `closed`. */
  openDurationMs: number;
  /** Cooldown after a failed probe reopens the breaker. */
  reopenDurationMs: number;
};

/** T3: conservative defaults from the spec; every value is env-overridable. */
export const CIRCUIT_BREAKER_DEFAULTS: Readonly<CircuitBreakerOptions> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
  reopenDurationMs: 60_000,
};

/**
 * Resolves the breaker tunables once at boot. Missing, non-numeric or
 * non-positive values fall back to the defaults above, so a typo in the
 * environment can never disable the protection or widen it unboundedly.
 */
export function readCircuitBreakerOptions(
  env: NodeJS.ProcessEnv = process.env,
): CircuitBreakerOptions {
  return {
    failureThreshold: readPositiveInt(
      env.IA_CB_FAILURE_THRESHOLD,
      CIRCUIT_BREAKER_DEFAULTS.failureThreshold,
    ),
    failureWindowMs: readPositiveInt(
      env.IA_CB_FAILURE_WINDOW_MS,
      CIRCUIT_BREAKER_DEFAULTS.failureWindowMs,
    ),
    openDurationMs: readPositiveInt(
      env.IA_CB_OPEN_DURATION_MS,
      CIRCUIT_BREAKER_DEFAULTS.openDurationMs,
    ),
    reopenDurationMs: readPositiveInt(
      env.IA_CB_REOPEN_DURATION_MS,
      CIRCUIT_BREAKER_DEFAULTS.reopenDurationMs,
    ),
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
