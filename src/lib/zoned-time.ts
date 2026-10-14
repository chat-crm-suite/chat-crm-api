// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Timezone arithmetic on IANA zones with the built-in `Intl` API (no date
 * library): wall-clock parts of an instant in a zone, and the instant of a
 * wall-clock time in a zone (DST-aware). Analytics buckets days and hours on
 * the company clock with these helpers.
 */

/** Server default zone, the same one the logger config pins (`APP_TZ`). */
export const defaultTimeZone = (): string =>
  process.env.APP_TZ || 'America/Lima';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** True when `timeZone` is a zone the runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function zonedParts(instant: Date | number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 1,
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`: local = utc + offset. */
function offsetMs(instant: number, timeZone: string): number {
  const date = new Date(instant);
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // Drop sub-second noise so the offset is a whole number of seconds.
  return asUtc - (instant - (instant % 1000));
}

/**
 * The instant of a wall-clock time in `timeZone`. Inside a DST gap the time
 * shifts forward, inside an overlap the earlier instant wins.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return Math.min(first, second);
}

/** `YYYY-MM-DD` of `instant` on the `timeZone` calendar. */
export function zonedDateKey(instant: Date | number, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return formatDateKey(year, month, day);
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Start instant (local midnight) of the `timeZone` day containing `instant`. */
export function startOfZonedDay(instant: Date | number, timeZone: string): number {
  const { year, month, day } = zonedParts(instant, timeZone);
  return zonedTimeToUtc(year, month, day, 0, 0, timeZone);
}

/** Calendar date `days` after the given one (pure date math, no zone). */
export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Every `YYYY-MM-DD` key on the `timeZone` calendar from the day of `from`
 * through the day of `to` (inclusive), capped at `maxDays`.
 */
export function zonedDateKeys(
  from: Date | number,
  to: Date | number,
  timeZone: string,
  maxDays = 400,
): string[] {
  const start = zonedParts(from, timeZone);
  const endKey = zonedDateKey(to, timeZone);
  const keys: string[] = [];

  for (let i = 0; i < maxDays; i++) {
    const { year, month, day } = addCalendarDays(
      start.year,
      start.month,
      start.day,
      i,
    );
    const key = formatDateKey(year, month, day);
    keys.push(key);
    if (key >= endKey) break;
  }

  return keys;
}

/** `YYYY-MM` of `instant` on the `timeZone` calendar. */
export function zonedMonthKey(instant: Date | number, timeZone: string): string {
  const { year, month } = zonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Instants bounding a calendar month (`YYYY-MM`) on the `timeZone` clock:
 * `from` is the 1st at 00:00, `to` the 1st of the next month (exclusive).
 */
export function zonedMonthBounds(
  month: string,
  timeZone: string,
): { from: number; to: number; daysInMonth: number } {
  const [year, monthIndex] = month.split('-').map(Number);
  const next = addCalendarDays(year, monthIndex, 1, 32);
  const from = zonedTimeToUtc(year, monthIndex, 1, 0, 0, timeZone);
  const to = zonedTimeToUtc(next.year, next.month, 1, 0, 0, timeZone);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from, to, daysInMonth };
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekdayOf(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
