// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { DurationSummary, Histogram } from '../../contracts/index';
import { PERCENTILE_MIN_SAMPLE } from '../../contracts/index';
import { round, sufficiency } from './sufficiency';

/**
 * Sample quantile with linear interpolation between order statistics
 * (Hyndman & Fan type 7, the default of R and NumPy). `null` for an empty
 * sample. `sorted` must be ascending.
 */
export function quantileSorted(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

export function quantile(values: readonly number[], p: number): number | null {
  return quantileSorted([...values].sort((a, b) => a - b), p);
}

export const median = (values: readonly number[]): number | null =>
  quantile(values, 0.5);

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n − 1). `null` below two observations. */
export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const squares = values.reduce((sum, value) => sum + (value - m) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/**
 * Median and p90 of a duration sample. Durations are right-skewed (one case
 * forgotten overnight drags a mean for days), so the center is the median and
 * the tail the 90th percentile. Below `PERCENTILE_MIN_SAMPLE` the values are
 * still returned but flagged `insufficient`.
 */
export function summarizeDurations(
  values: readonly number[],
  minimumSample = PERCENTILE_MIN_SAMPLE,
): DurationSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    median: round(quantileSorted(sorted, 0.5), 1),
    p90: round(quantileSorted(sorted, 0.9), 1),
    meta: sufficiency(sorted.length, minimumSample),
  };
}

/**
 * Upper edges (seconds) of the duration histogram: roughly logarithmic, so
 * both "answered in 20 s" and "answered after lunch" stay readable. The last
 * bin is open-ended.
 */
export const DURATION_BIN_EDGES = [
  30, 60, 120, 300, 600, 1800, 3600, 7200, 14_400,
] as const;

export function durationHistogram(
  values: readonly number[],
  minimumSample = PERCENTILE_MIN_SAMPLE,
): Histogram {
  const counts = new Array<number>(DURATION_BIN_EDGES.length + 1).fill(0);
  let size = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    size++;
    const index = DURATION_BIN_EDGES.findIndex((edge) => value < edge);
    counts[index === -1 ? DURATION_BIN_EDGES.length : index]++;
  }

  return {
    bins: counts.map((count, index) => ({
      fromSeconds: index === 0 ? 0 : DURATION_BIN_EDGES[index - 1],
      toSeconds: index < DURATION_BIN_EDGES.length ? DURATION_BIN_EDGES[index] : null,
      count,
    })),
    meta: sufficiency(size, minimumSample),
  };
}
