// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  isRetryableSkipReason,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_MS,
  retryDelayMs,
  SENTIMENT_RETRY_BATCH_SIZE,
  SENTIMENT_RETRY_INTERVAL_MS,
} from './sentiment-retry.policy';

/**
 * T4: the deferred-retry policy is the spec's contract, so it is pinned with
 * literal values: 5m → 24h over 8 attempts, a ~100-row batch and a 5-minute
 * scan. Only real unavailability is retryable.
 */
describe('sentiment retry policy (T4)', () => {
  it('waits 5m, 15m, 30m, 1h, 2h, 6h, 12h and 24h before attempts 1..8', () => {
    expect(RETRY_BACKOFF_MS).toEqual([
      300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000,
      86_400_000,
    ]);
    expect(MAX_RETRY_ATTEMPTS).toBe(8);

    RETRY_BACKOFF_MS.forEach((expected, index) => {
      expect(retryDelayMs(index + 1)).toBe(expected);
    });
  });

  it('gives up after attempt 8', () => {
    expect(retryDelayMs(8)).toBe(86_400_000);
    expect(retryDelayMs(9)).toBeNull();
    expect(retryDelayMs(0)).toBeNull();
    expect(retryDelayMs(-1)).toBeNull();
  });

  it('retries only real unavailability, never a manual skip', () => {
    expect(isRetryableSkipReason('ia_unavailable')).toBe(true);
    expect(isRetryableSkipReason('circuit_breaker')).toBe(true);
    expect(isRetryableSkipReason('kill_switch')).toBe(false);
    expect(isRetryableSkipReason(null)).toBe(false);
    expect(isRetryableSkipReason(undefined)).toBe(false);
  });

  it('scans every 5 minutes with a bounded batch', () => {
    expect(SENTIMENT_RETRY_INTERVAL_MS).toBe(300_000);
    expect(SENTIMENT_RETRY_BATCH_SIZE).toBe(100);
  });
});
