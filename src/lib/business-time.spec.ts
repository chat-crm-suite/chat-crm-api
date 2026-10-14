// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { BusinessHours } from '../contracts/index';
import { businessSeconds, isWithinBusinessHours } from './business-time';
import { zonedDateKey, zonedDateKeys, zonedTimeToUtc } from './zoned-time';

/** Lima is UTC-5 all year (no DST), which keeps the expectations readable. */
const weekdays9to18: BusinessHours = {
  timezone: 'America/Lima',
  days: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    intervals: [{ start: '09:00', end: '18:00' }],
  })),
};

// 2026-10-12 is a Monday.
const lima = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, day, hour + 5, minute));

describe('businessSeconds', () => {
  it('returns the wall-clock span for a 24/7 company', () => {
    expect(businessSeconds(lima(12, 10), lima(12, 10, 5), null)).toBe(300);
  });

  it('counts only the open part of the day', () => {
    // 08:00 → 10:00 Monday: only 09:00–10:00 is business time.
    expect(businessSeconds(lima(12, 8), lima(12, 10), weekdays9to18)).toBe(3600);
  });

  it('skips the night and the weekend', () => {
    // Friday 17:30 → Monday 09:30 = 30 min Friday + 30 min Monday.
    expect(businessSeconds(lima(16, 17, 30), lima(19, 9, 30), weekdays9to18)).toBe(
      3600,
    );
  });

  it('is zero for a span fully outside business hours', () => {
    expect(businessSeconds(lima(17, 10), lima(18, 20), weekdays9to18)).toBe(0);
  });

  it('is zero for reversed or empty spans', () => {
    expect(businessSeconds(lima(12, 10), lima(12, 9), weekdays9to18)).toBe(0);
    expect(businessSeconds(lima(12, 10), lima(12, 10), null)).toBe(0);
  });

  it('handles split shifts', () => {
    const split: BusinessHours = {
      timezone: 'America/Lima',
      days: [
        {
          weekday: 1,
          intervals: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '18:00' },
          ],
        },
      ],
    };
    expect(businessSeconds(lima(12, 12), lima(12, 15), split)).toBe(2 * 3600);
  });

  it('follows DST on zones that have it', () => {
    // Madrid leaves summer time on 2026-10-25 (that Sunday is 25 h long).
    const always: BusinessHours = {
      timezone: 'Europe/Madrid',
      days: [7].map((weekday) => ({
        weekday,
        intervals: [{ start: '00:00', end: '23:59' }],
      })),
    };
    const start = zonedTimeToUtc(2026, 10, 25, 0, 0, 'Europe/Madrid');
    const end = zonedTimeToUtc(2026, 10, 25, 23, 59, 'Europe/Madrid');
    expect(businessSeconds(start, end, always)).toBe(24 * 3600 + 59 * 60);
  });
});

describe('isWithinBusinessHours', () => {
  it('checks the local clock of the company', () => {
    expect(isWithinBusinessHours(lima(12, 9), weekdays9to18)).toBe(true);
    expect(isWithinBusinessHours(lima(12, 18), weekdays9to18)).toBe(false);
    expect(isWithinBusinessHours(lima(18, 12), weekdays9to18)).toBe(false);
    expect(isWithinBusinessHours(lima(18, 12), null)).toBe(true);
  });
});

describe('zoned calendar helpers', () => {
  it('keys instants by the local day', () => {
    // 2026-10-13 03:00 UTC is still the 12th in Lima.
    expect(zonedDateKey(new Date(Date.UTC(2026, 9, 13, 3)), 'America/Lima')).toBe(
      '2026-10-12',
    );
  });

  it('lists every local day of a range', () => {
    expect(zonedDateKeys(lima(30, 10), lima(1 + 31, 10), 'America/Lima')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });
});
