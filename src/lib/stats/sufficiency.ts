// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { DataSufficiency } from '../../contracts/index';

/**
 * `empty` with no observations, `insufficient` below the method's floor,
 * `ok` otherwise. Every statistic travels with this so consumers can explain
 * a missing number instead of drawing a misleading one.
 */
export function sufficiency(
  sampleSize: number,
  minimumSample: number,
): DataSufficiency {
  const size = Math.max(0, Math.floor(sampleSize));
  return {
    status: size === 0 ? 'empty' : size < minimumSample ? 'insufficient' : 'ok',
    sampleSize: size,
    minimumSample,
  };
}

/** Rounds to `digits` decimals, keeping `null` (and never emitting `-0`). */
export function round(value: number, digits?: number): number;
export function round(value: number | null, digits?: number): number | null;
export function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor + 0;
}

/** Clamps into `[0, 1]` (floating noise around the edges of a proportion). */
export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));
