// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ControlChart } from '../../contracts/index';
import { CONTROL_CHART_MIN_POINTS } from '../../contracts/index';
import { round, sufficiency } from './sufficiency';

/** 3 / d₂ with d₂ = 1.128 for moving ranges of two (Wheeler). */
export const XMR_SCALING = 2.66;
/** Western Electric rule 2 (run length on one side of the center). */
export const RUN_LENGTH = 8;

export interface XmrLimits {
  center: number;
  upper: number;
  lower: number;
  averageMovingRange: number;
}

/**
 * Individuals (XmR) chart limits: center = mean of the points, natural
 * process limits = center ± 2.66 × average moving range. Needs two points
 * (one moving range); callers apply the sufficiency floor.
 */
export function xmrLimits(values: readonly number[]): XmrLimits | null {
  if (values.length < 2) return null;

  const center = values.reduce((sum, value) => sum + value, 0) / values.length;
  let ranges = 0;
  for (let i = 1; i < values.length; i++) {
    ranges += Math.abs(values[i] - values[i - 1]);
  }
  const averageMovingRange = ranges / (values.length - 1);

  return {
    center,
    upper: center + XMR_SCALING * averageMovingRange,
    lower: center - XMR_SCALING * averageMovingRange,
    averageMovingRange,
  };
}

export interface ControlChartOptions {
  /** Lower bound of the measure (durations and rates cannot go below 0). */
  floor?: number;
  /** Upper bound of the measure (rates cannot exceed 1). */
  ceiling?: number;
  minimumPoints?: number;
  digits?: number;
}

/**
 * Builds an XmR chart over a daily series. Days with no data (`null`) are
 * kept on the axis but excluded from the limits and the run rule. Signals:
 * `beyond-limits` (rule 1) and `run-of-8` (rule 2, flagged from the 8th
 * consecutive point on the same side). Below the floor the points are
 * returned without limits or signals.
 */
export function buildControlChart(
  series: readonly { date: string; value: number | null }[],
  options: ControlChartOptions = {},
): ControlChart {
  const {
    floor,
    ceiling,
    minimumPoints = CONTROL_CHART_MIN_POINTS,
    digits = 4,
  } = options;
  const observed = series
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const meta = sufficiency(observed.length, minimumPoints);
  const limits = meta.status === 'ok' ? xmrLimits(observed) : null;

  if (!limits) {
    return {
      points: series.map((point) => ({
        date: point.date,
        value: round(point.value, digits),
        signal: 'none',
      })),
      center: null,
      upperLimit: null,
      lowerLimit: null,
      meta,
    };
  }

  const upper = ceiling === undefined ? limits.upper : Math.min(ceiling, limits.upper);
  const lower = floor === undefined ? limits.lower : Math.max(floor, limits.lower);

  let runSide = 0;
  let runLength = 0;
  const points = series.map((point) => {
    if (point.value === null || !Number.isFinite(point.value)) {
      return { date: point.date, value: null, signal: 'none' as const };
    }

    const side = Math.sign(point.value - limits.center);
    if (side !== 0 && side === runSide) {
      runLength++;
    } else {
      runSide = side;
      runLength = side === 0 ? 0 : 1;
    }

    const signal =
      point.value > upper || point.value < lower
        ? ('beyond-limits' as const)
        : runLength >= RUN_LENGTH
          ? ('run-of-8' as const)
          : ('none' as const);

    return { date: point.date, value: round(point.value, digits), signal };
  });

  return {
    points,
    center: round(limits.center, digits),
    upperLimit: round(upper, digits),
    lowerLimit: round(lower, digits),
    meta,
  };
}
