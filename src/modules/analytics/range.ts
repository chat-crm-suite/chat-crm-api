// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AnalyticsPeriod, AnalyticsRange } from '../../contracts/index';
import {
  addCalendarDays,
  zonedMonthBounds,
  zonedParts,
  zonedTimeToUtc,
} from '../../lib/zoned-time';
import type { TimeRange } from './analytics.types';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Turns `period` / `month` into instants on the company clock. Periods are
 * whole local days ending now (`7d` = today and the 6 days before). A month
 * runs from its 1st to its end, or to now while it is the current month.
 */
export function resolveRange(
  query: { period?: AnalyticsPeriod; month?: string },
  timezone: string,
  now: number,
): { range: TimeRange; info: AnalyticsRange } {
  if (query.month) {
    const bounds = zonedMonthBounds(query.month, timezone);
    const to = Math.max(bounds.from + 1, Math.min(bounds.to, now));
    return {
      range: { from: bounds.from, to },
      info: {
        from: new Date(bounds.from),
        to: new Date(to),
        period: null,
        month: query.month,
        timezone,
      },
    };
  }

  const period = query.period ?? '7d';
  const today = zonedParts(now, timezone);
  const first = addCalendarDays(today.year, today.month, today.day, -(PERIOD_DAYS[period] - 1));
  const from = zonedTimeToUtc(first.year, first.month, first.day, 0, 0, timezone);
  const to = Math.max(from + 1, now);

  return {
    range: { from, to },
    info: { from: new Date(from), to: new Date(to), period, month: null, timezone },
  };
}

/** True when the range ended before today (its data no longer changes). */
export const isClosedRange = (range: TimeRange, now: number) => range.to < now - 60_000;
