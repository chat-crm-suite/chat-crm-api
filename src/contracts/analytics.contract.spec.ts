// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  AnalyticsRangeQuerySchema,
  LiveSnapshotSchema,
  RateEstimateSchema,
} from './analytics.contract';
import { CloseCaseSchema } from './case.contract';
import { IaStatusSchema } from './ia.contract';
import { UpdatePresenceSchema } from './presence.contract';
import { ServiceSettingsSchema } from './service-settings.contract';
import { UpdateBudgetSchema } from './spend.contract';

const emptyMeta = { status: 'empty', sampleSize: 0, minimumSample: 1 } as const;

describe('analytics contracts', () => {
  it('defaults the range query to 7 days across all channels', () => {
    expect(AnalyticsRangeQuerySchema.parse({})).toEqual({
      period: '7d',
      channel: 'all',
    });
  });

  it('accepts a single channel type and a calendar month', () => {
    expect(
      AnalyticsRangeQuerySchema.parse({ channel: 'telegram', month: '2026-10' }),
    ).toMatchObject({ channel: 'telegram', month: '2026-10' });
    expect(
      AnalyticsRangeQuerySchema.safeParse({ month: '2026-13' }).success,
    ).toBe(false);
    expect(AnalyticsRangeQuerySchema.safeParse({ channel: 'fax' }).success).toBe(
      false,
    );
  });

  it('describes an empty database with a full-shaped live snapshot', () => {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      slaSeconds: 300,
      waiting: [],
      waitingTotal: 0,
      queue: { unassignedCount: 0, oldestWaitingSeconds: null },
      queuePressure: null,
      agents: [],
      me: null,
    };
    expect(LiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('represents an uncomputable rate as null, never NaN', () => {
    const empty = {
      value: null,
      successes: 0,
      trials: 0,
      interval: null,
      adjusted: null,
      meta: emptyMeta,
    };
    expect(RateEstimateSchema.safeParse(empty).success).toBe(true);
    expect(RateEstimateSchema.safeParse({ ...empty, value: NaN }).success).toBe(
      false,
    );
    expect(RateEstimateSchema.safeParse({ ...empty, value: 1.2 }).success).toBe(
      false,
    );
  });
});

describe('service settings contract', () => {
  const base = { slaFirstResponseSeconds: 300, slaTargetShare: 0.8 };

  it('accepts 24/7 (null business hours)', () => {
    expect(
      ServiceSettingsSchema.safeParse({ ...base, businessHours: null }).success,
    ).toBe(true);
  });

  it('rejects intervals that end before they start', () => {
    const businessHours = {
      timezone: 'America/Lima',
      days: [{ weekday: 1, intervals: [{ start: '18:00', end: '09:00' }] }],
    };
    expect(
      ServiceSettingsSchema.safeParse({ ...base, businessHours }).success,
    ).toBe(false);
  });
});

describe('case, presence, spend and IA contracts', () => {
  it('lets agents pick only manual presence states', () => {
    expect(UpdatePresenceSchema.safeParse({ state: 'away' }).success).toBe(true);
    expect(UpdatePresenceSchema.safeParse({ state: 'offline' }).success).toBe(
      false,
    );
  });

  it('closes a case with an optional, bounded note', () => {
    expect(CloseCaseSchema.parse({})).toEqual({});
    expect(CloseCaseSchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('removes the budget with null and rejects zero', () => {
    expect(UpdateBudgetSchema.safeParse({ monthlyBudgetUsd: null }).success).toBe(
      true,
    );
    expect(UpdateBudgetSchema.safeParse({ monthlyBudgetUsd: 0 }).success).toBe(
      false,
    );
  });

  it('reports the IA as unavailable while the breaker is open', () => {
    expect(
      IaStatusSchema.parse({
        status: 'unavailable',
        enabled: true,
        available: false,
        breaker: 'open',
      }).available,
    ).toBe(false);
  });
});
