// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { PROJECTION_MIN_DAYS } from '../../contracts/index';
import type { DataSufficiency } from '../../contracts/index';
import { mean, sampleStdDev } from './descriptive';
import { Z_95 } from './proportion';
import { round, sufficiency } from './sufficiency';

/** Two-sided 95% Student-t quantiles for 1–30 degrees of freedom. */
const T_975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201,
  2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074,
  2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * 97.5% quantile of Student's t with `df` degrees of freedom: tabulated up to
 * 30, then the Cornish–Fisher expansion around the normal quantile (error
 * below 0.001 from there on).
 */
export function tQuantile975(df: number): number {
  if (df < 1) return Number.POSITIVE_INFINITY;
  if (df <= T_975.length) return T_975[Math.floor(df) - 1];
  const z = Z_95;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
  );
}

export interface RunRateProjection {
  expected: number;
  low: number;
  high: number;
  meta: DataSufficiency;
}

/**
 * Month-end projection from the daily totals observed so far.
 *
 * The remaining `R` days are forecast at the mean daily rate `m`; the 95%
 * prediction interval for their sum uses `t·s·√(R + R²/n)` — day-to-day
 * variation of the future days plus the uncertainty of the mean itself. The
 * spend already incurred is certain, so it is added as is and the low end
 * never drops below it. `null` below `PROJECTION_MIN_DAYS` observed days.
 */
export function runRateProjection(input: {
  dailyTotals: readonly number[];
  spentSoFar: number;
  remainingDays: number;
  minimumDays?: number;
}): RunRateProjection | null {
  const { dailyTotals, spentSoFar, minimumDays = PROJECTION_MIN_DAYS } = input;
  const remaining = Math.max(0, input.remainingDays);
  const meta = sufficiency(dailyTotals.length, minimumDays);
  if (meta.status !== 'ok') return null;

  const average = mean(dailyTotals) as number;
  const deviation = sampleStdDev(dailyTotals) ?? 0;
  const n = dailyTotals.length;
  const expected = spentSoFar + average * remaining;
  const margin =
    tQuantile975(n - 1) * deviation * Math.sqrt(remaining + (remaining * remaining) / n);

  return {
    expected: round(expected, 2),
    low: round(Math.max(spentSoFar, expected - margin), 2),
    high: round(expected + margin, 2),
    meta,
  };
}
