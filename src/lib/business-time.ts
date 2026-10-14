// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { BusinessHours } from '../contracts/index';
import {
  addCalendarDays,
  isoWeekdayOf,
  zonedParts,
  zonedTimeToUtc,
} from './zoned-time';

/** Hard stop for pathological spans (a case open for years). */
const MAX_DAYS = 370;

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Seconds of business time between two instants. `hours === null` means the
 * company works 24/7, so the wall-clock span is returned. Otherwise only the
 * overlap with each day's open intervals (on the company timezone, DST-aware)
 * counts: a message on Saturday night does not age until Monday opens.
 */
export function businessSeconds(
  from: Date | number,
  to: Date | number,
  hours: BusinessHours | null,
): number {
  const start = typeof from === 'number' ? from : from.getTime();
  const end = typeof to === 'number' ? to : to.getTime();
  if (!(end > start)) return 0;
  if (!hours) return (end - start) / 1000;

  const schedule = new Map<number, { start: number; end: number }[]>();
  for (const day of hours.days) {
    schedule.set(
      day.weekday,
      day.intervals.map((interval) => ({
        start: toMinutes(interval.start),
        end: toMinutes(interval.end),
      })),
    );
  }
  if (![...schedule.values()].some((intervals) => intervals.length)) return 0;

  const { timezone } = hours;
  const first = zonedParts(start, timezone);
  let totalMs = 0;

  for (let i = 0; i < MAX_DAYS; i++) {
    const date = addCalendarDays(first.year, first.month, first.day, i);
    const dayStart = zonedTimeToUtc(date.year, date.month, date.day, 0, 0, timezone);
    if (dayStart >= end) break;

    const intervals = schedule.get(isoWeekdayOf(date.year, date.month, date.day));
    for (const interval of intervals ?? []) {
      const open = zonedTimeToUtc(
        date.year,
        date.month,
        date.day,
        Math.floor(interval.start / 60),
        interval.start % 60,
        timezone,
      );
      const close = zonedTimeToUtc(
        date.year,
        date.month,
        date.day,
        Math.floor(interval.end / 60),
        interval.end % 60,
        timezone,
      );
      const overlap = Math.min(close, end) - Math.max(open, start);
      if (overlap > 0) totalMs += overlap;
    }
  }

  return totalMs / 1000;
}

/** Whether `instant` falls inside an open interval (always true for 24/7). */
export function isWithinBusinessHours(
  instant: Date | number,
  hours: BusinessHours | null,
): boolean {
  if (!hours) return true;

  const parts = zonedParts(instant, hours.timezone);
  const minutes = parts.hour * 60 + parts.minute;
  const day = hours.days.find((candidate) => candidate.weekday === parts.weekday);

  return (day?.intervals ?? []).some(
    (interval) =>
      minutes >= toMinutes(interval.start) && minutes < toMinutes(interval.end),
  );
}
