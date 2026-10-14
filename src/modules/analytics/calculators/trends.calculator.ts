// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  AnalyticsRange,
  Delivery,
  SentimentAnalytics,
  Staffing,
  Volume,
} from '@contracts';
import {
  PERCENTILE_MIN_SAMPLE,
  STAFFING_MIN_HISTORY_DAYS,
} from '@contracts';
import { businessSeconds } from '@lib/business-time';
import {
  buildControlChart,
  median,
  rateEstimate,
  requiredAgents,
  round,
  sufficiency,
} from '@lib/stats/index';
import { zonedDateKey, zonedDateKeys, zonedParts, zonedTimeToUtc } from '@lib/zoned-time';
import type { CaseRow, MeasureContext, TimeRange, ToneRow } from '../analytics.types';
import type { DeliveryCountRow, MessageCountRow } from '../queries/activity.query';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Weeks of history behind the arrival profile (8 weeks of seasonality). */
export const STAFFING_HISTORY_DAYS = 56;
/** Forecast horizon: the current hour plus the next 7. */
export const STAFFING_HORIZON_HOURS = 8;

// ---------------------------------------------------------------------------
// Staffing — Erlang C on the hour-of-week arrival profile
// ---------------------------------------------------------------------------

export interface StaffingInput {
  context: MeasureContext;
  /** Cases opened in the last `STAFFING_HISTORY_DAYS`. */
  opened: CaseRow[];
  /** Cases closed in the same window (handle time). */
  closed: CaseRow[];
  availableAgents: number;
}

/**
 * Required agents per hour with Erlang C (M/M/N).
 *
 * - λ per (weekday, hour) = arrivals in that slot ÷ weeks observed.
 * - AHT = median business-time handle (open → close) of recent cases.
 * - Chat agents serve several conversations at once, so the Erlang servers
 *   are agent × concurrency (the company's per-agent cap, 1 when unlimited)
 *   and the result is divided back into agents (rounded up).
 */
export function computeStaffing(input: StaffingInput): Staffing {
  const { context } = input;
  const tz = context.timezone;
  const earliest = input.opened.reduce((min, row) => Math.min(min, row.openedAt), context.now);
  const historyDays = input.opened.length
    ? Math.min(STAFFING_HISTORY_DAYS, Math.max(1, Math.ceil((context.now - earliest) / DAY_MS)))
    : 0;
  const weeks = Math.max(1, historyDays / 7);

  const slots = new Map<string, number>();
  for (const row of input.opened) {
    const parts = zonedParts(row.openedAt, tz);
    const key = `${parts.weekday}:${parts.hour}`;
    slots.set(key, (slots.get(key) ?? 0) + 1);
  }

  const heatmap: Staffing['heatmap'] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({
        weekday,
        hour,
        averageArrivals: round((slots.get(`${weekday}:${hour}`) ?? 0) / weeks, 2),
      });
    }
  }

  const handleTimes = input.closed
    .filter((row) => row.closedAt !== null)
    .map((row) => businessSeconds(row.openedAt, row.closedAt as number, context.hours))
    .filter((seconds) => seconds > 0);
  const handleSeconds = median(handleTimes);
  const meta = sufficiency(historyDays, STAFFING_MIN_HISTORY_DAYS);
  const concurrency = context.defaultCapacity ?? 1;

  const now = zonedParts(context.now, tz);
  const currentHour = zonedTimeToUtc(now.year, now.month, now.day, now.hour, 0, tz);
  const hours: Staffing['hours'] = [];
  for (let i = 0; i < STAFFING_HORIZON_HOURS; i++) {
    const hourStart = currentHour + i * HOUR_MS;
    const parts = zonedParts(hourStart, tz);
    const expected = (slots.get(`${parts.weekday}:${parts.hour}`) ?? 0) / weeks;
    const servers =
      meta.status === 'ok' && handleSeconds
        ? requiredAgents({
            arrivalsPerHour: expected,
            handleSeconds,
            targetSeconds: context.slaSeconds,
            targetShare: context.targetShare,
          })
        : null;

    hours.push({
      hourStart: new Date(hourStart),
      expectedArrivals: round(expected, 2),
      requiredAgents: servers === null ? null : Math.ceil(servers / concurrency),
      availableAgents: input.availableAgents,
    });
  }

  return {
    slaSeconds: context.slaSeconds,
    targetServiceLevel: context.targetShare,
    handleTimeSeconds: round(handleSeconds, 0),
    historyDays,
    hours,
    heatmap,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export interface VolumeInput {
  context: MeasureContext;
  range: TimeRange;
  rangeInfo: AnalyticsRange;
  cases: CaseRow[];
  messages: MessageCountRow[];
  backlogAtStart: number;
  firstCaseAt: Map<string, number>;
}

export function computeVolume(input: VolumeInput): Volume {
  const { context, range } = input;
  const tz = context.timezone;
  const days = zonedDateKeys(range.from, range.to - 1, tz);
  const counters = new Map(
    days.map((date) => [
      date,
      { newCases: 0, resolvedCases: 0, inboundMessages: 0, outboundMessages: 0 },
    ]),
  );

  const inRange = (instant: number | null) =>
    instant !== null && instant >= range.from && instant < range.to;

  for (const row of input.cases) {
    if (inRange(row.openedAt)) {
      const day = counters.get(zonedDateKey(row.openedAt, tz));
      if (day) day.newCases++;
    }
    if (row.status === 'closed' && inRange(row.closedAt)) {
      const day = counters.get(zonedDateKey(row.closedAt as number, tz));
      if (day) day.resolvedCases++;
    }
  }
  for (const message of input.messages) {
    const day = counters.get(zonedDateKey(message.at, tz));
    if (!day) continue;
    if (message.direction === 'inbound') day.inboundMessages++;
    else day.outboundMessages++;
  }

  let backlog = input.backlogAtStart;
  const series = days.map((date) => {
    const day = counters.get(date)!;
    backlog = Math.max(0, backlog + day.newCases - day.resolvedCases);
    return { date, ...day, backlog };
  });

  const opened = input.cases.filter((row) => inRange(row.openedAt));
  const customers = new Set(opened.map((row) => row.customerId));
  let fresh = 0;
  for (const customer of customers) {
    const first = input.firstCaseAt.get(customer);
    if (first !== undefined && first >= range.from) fresh++;
  }

  const activity = opened.length + input.messages.length;

  return {
    range: input.rangeInfo,
    days: series,
    newCasesControl: buildControlChart(
      series.map((day) => ({ date: day.date, value: day.newCases })),
      { floor: 0, digits: 2 },
    ),
    customers: {
      new: fresh,
      returning: customers.size - fresh,
      casesPerCustomer: customers.size ? round(opened.length / customers.size, 2) : null,
    },
    meta: sufficiency(activity, 1),
  };
}

// ---------------------------------------------------------------------------
// Delivery health
// ---------------------------------------------------------------------------

export function computeDelivery(rows: DeliveryCountRow[], rangeInfo: AnalyticsRange): Delivery {
  const count = (statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);

  // `pending` never reached the provider: it is not part of "sent".
  const sent = count(['sent', 'delivered', 'read', 'failed']);
  const errors = new Map<string, { message: string | null; count: number }>();
  for (const row of rows) {
    if (row.status !== 'failed') continue;
    const code = row.errorCode ?? 'unknown';
    const entry = errors.get(code) ?? { message: row.errorMessage, count: 0 };
    entry.count += row.count;
    errors.set(code, entry);
  }

  return {
    range: rangeInfo,
    sent,
    delivered: rateEstimate(count(['delivered', 'read']), sent),
    read: rateEstimate(count(['read']), sent),
    failed: rateEstimate(count(['failed']), sent),
    topErrors: [...errors.entries()]
      .map(([code, entry]) => ({ code, message: entry.message, count: entry.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Customer tone
// ---------------------------------------------------------------------------

export function computeSentiment(
  rows: ToneRow[],
  context: MeasureContext,
  range: TimeRange,
  rangeInfo: AnalyticsRange,
  scope: SentimentAnalytics['scope'],
): SentimentAnalytics {
  const days = zonedDateKeys(range.from, range.to - 1, context.timezone);
  const counters = new Map(days.map((date) => [date, { positive: 0, neutral: 0, negative: 0 }]));
  for (const row of rows) {
    const day = counters.get(zonedDateKey(row.at, context.timezone));
    if (day) day[row.label]++;
  }

  const series = days.map((date) => ({ date, ...counters.get(date)! }));
  const total = rows.length;
  const share = (label: 'positive' | 'neutral' | 'negative') =>
    total ? round(rows.filter((row) => row.label === label).length / total) : null;

  return {
    range: rangeInfo,
    scope,
    days: series,
    share: { positive: share('positive'), neutral: share('neutral'), negative: share('negative') },
    negativeControl: buildControlChart(
      series.map((day) => {
        const sum = day.positive + day.neutral + day.negative;
        return { date: day.date, value: sum ? day.negative / sum : null };
      }),
      { floor: 0, ceiling: 1 },
    ),
    meta: sufficiency(total, PERCENTILE_MIN_SAMPLE),
  };
}
