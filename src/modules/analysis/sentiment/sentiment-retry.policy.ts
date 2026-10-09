// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AnalysisSkipReason } from '@contracts';

/** T4: dedicated queue whose repeatable scan triggers the retry worker. */
export const SENTIMENT_RETRY_QUEUE = 'sentiment-retry' as const;
export const SENTIMENT_RETRY_SCAN_JOB = 'sentiment-retry-scan' as const;
export const SENTIMENT_RETRY_SCHEDULER_ID = 'sentiment-retry-scan' as const;

/** T4: the scan runs every 5 minutes and processes at most 100 analyses. */
export const SENTIMENT_RETRY_INTERVAL_MS = 5 * 60_000;
export const SENTIMENT_RETRY_BATCH_SIZE = 100;

/**
 * T4: wait before each deferred retry attempt (1-based): 5m, 15m, 30m, 1h,
 * 2h, 6h, 12h, 24h. A ninth attempt never happens: the analysis stays
 * `skipped` and visible.
 */
export const RETRY_BACKOFF_MS = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export const MAX_RETRY_ATTEMPTS = RETRY_BACKOFF_MS.length;

/** Only real unavailability is retryable; `kill_switch` is a deliberate stop. */
export const RETRYABLE_SKIP_REASONS: readonly AnalysisSkipReason[] = [
  'ia_unavailable',
  'circuit_breaker',
];

export function isRetryableSkipReason(
  reason: AnalysisSkipReason | null | undefined,
): boolean {
  return reason != null && RETRYABLE_SKIP_REASONS.includes(reason);
}

/**
 * Delay before retry attempt `attempt` (1-based); `null` once the 8-attempt
 * cap is exceeded, which is the signal to give up.
 */
export function retryDelayMs(attempt: number): number | null {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > MAX_RETRY_ATTEMPTS
  ) {
    return null;
  }

  return RETRY_BACKOFF_MS[attempt - 1];
}
