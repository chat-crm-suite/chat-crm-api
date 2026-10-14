// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  buildControlChart,
  durationHistogram,
  erlangC,
  erlangServiceLevel,
  estimateBetaPrior,
  littlesLaw,
  quantile,
  rateEstimate,
  requiredAgents,
  runRateProjection,
  shrinkRate,
  summarizeDurations,
  sufficiency,
  tQuantile975,
  wilsonInterval,
  withShrinkage,
  xmrLimits,
} from './index';

const days = (values: (number | null)[]) =>
  values.map((value, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value }));

describe('sufficiency', () => {
  it('classifies empty, insufficient and ok samples', () => {
    expect(sufficiency(0, 5).status).toBe('empty');
    expect(sufficiency(4, 5).status).toBe('insufficient');
    expect(sufficiency(5, 5)).toEqual({ status: 'ok', sampleSize: 5, minimumSample: 5 });
  });
});

describe('quantiles (Hyndman & Fan type 7, as R / NumPy)', () => {
  it('matches R quantile()', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(values, 0.5)).toBe(5.5);
    expect(quantile(values, 0.9)).toBeCloseTo(9.1, 10);
    expect(quantile([5, 1, 100, 3, 2], 0.9)).toBeCloseTo(62, 10);
  });

  it('is null for an empty sample', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(summarizeDurations([])).toEqual({
      median: null,
      p90: null,
      meta: { status: 'empty', sampleSize: 0, minimumSample: 5 },
    });
  });

  it('flags small duration samples as insufficient but keeps the values', () => {
    const summary = summarizeDurations([60, 120]);
    expect(summary.median).toBe(90);
    expect(summary.meta.status).toBe('insufficient');
  });

  it('bins durations on log-spaced edges with an open last bin', () => {
    const histogram = durationHistogram([10, 45, 45, 50_000]);
    expect(histogram.bins[0]).toEqual({ fromSeconds: 0, toSeconds: 30, count: 1 });
    expect(histogram.bins[1].count).toBe(2);
    expect(histogram.bins.at(-1)).toEqual({ fromSeconds: 14_400, toSeconds: null, count: 1 });
  });
});

describe('Wilson score interval (Newcombe 1998, Table I)', () => {
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [20, 20, 0.8389, 1],
  ])('%i/%i → [%f, %f]', (successes, trials, low, high) => {
    const interval = wilsonInterval(successes, trials);
    expect(interval?.low).toBeCloseTo(low, 4);
    expect(interval?.high).toBeCloseTo(high, 4);
  });

  it('has no interval without trials and never yields NaN', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(rateEstimate(0, 0)).toEqual({
      value: null,
      successes: 0,
      trials: 0,
      interval: null,
      adjusted: null,
      meta: { status: 'empty', sampleSize: 0, minimumSample: 1 },
    });
  });
});

describe('empirical-Bayes beta-binomial shrinkage', () => {
  const groups = [
    { successes: 5, trials: 50 },
    { successes: 45, trials: 50 },
    { successes: 20, trials: 25 },
    { successes: 1, trials: 3 },
    { successes: 80, trials: 100 },
  ];

  it('estimates the prior by the method of moments', () => {
    const prior = estimateBetaPrior(groups);
    expect(prior?.alpha).toBeCloseTo(0.8077, 3);
    expect(prior?.beta).toBeCloseTo(0.5691, 3);
    // Posterior means checked against an independent computation.
    const shrunk = groups.map((g) => shrinkRate(g.successes, g.trials, prior!));
    [0.113, 0.8916, 0.7889, 0.413, 0.7971].forEach((expected, i) =>
      expect(shrunk[i]).toBeCloseTo(expected, 3),
    );
  });

  it('moves small samples further than large ones', () => {
    const estimates = withShrinkage([
      rateEstimate(3, 3),
      rateEstimate(240, 300),
      rateEstimate(50, 100),
      rateEstimate(70, 100),
    ]);
    const tiny = estimates[0];
    const big = estimates[1];
    expect(tiny.adjusted!).toBeLessThan(1);
    expect(Math.abs(big.adjusted! - big.value!)).toBeLessThan(
      Math.abs(tiny.adjusted! - tiny.value!),
    );
    // 3/3 no longer outranks 240/300 by luck.
    expect(tiny.adjusted!).toBeLessThanOrEqual(big.adjusted! + 0.05);
  });

  it('shrinks to the pooled rate when spread is only noise', () => {
    const estimates = withShrinkage([
      rateEstimate(30, 40),
      rateEstimate(45, 50),
      rateEstimate(2, 3),
      rateEstimate(60, 100),
    ]);
    const pooled = 137 / 193;
    for (const estimate of estimates) {
      expect(estimate.adjusted).toBeCloseTo(pooled, 3);
    }
  });

  it('needs three agents with data', () => {
    expect(estimateBetaPrior([{ successes: 1, trials: 2 }, { successes: 2, trials: 2 }])).toBeNull();
    expect(withShrinkage([rateEstimate(1, 2)])[0].adjusted).toBeNull();
  });
});

describe('XmR control chart (Wheeler)', () => {
  it('computes the natural process limits', () => {
    const limits = xmrLimits([10, 12, 11, 13, 12, 11, 10, 12]);
    expect(limits?.center).toBeCloseTo(11.375, 6);
    expect(limits?.averageMovingRange).toBeCloseTo(1.428571, 5);
    expect(limits?.upper).toBeCloseTo(15.175, 6);
    expect(limits?.lower).toBeCloseTo(7.575, 6);
  });

  it('flags a point beyond the limits', () => {
    // Alternating around the center, so only the spike can signal.
    const chart = buildControlChart(days([5, 15, 5, 15, 5, 15, 5, 15, 5, 15, 5, 15, 60]));
    expect(chart.meta.status).toBe('ok');
    expect(chart.points.at(-1)?.signal).toBe('beyond-limits');
    expect(chart.points.slice(0, -1).every((p) => p.signal === 'none')).toBe(true);
  });

  it('flags eight in a row on one side of the center', () => {
    const series = [9, 1, 9, 1, 9, 1, 6, 6, 6, 6, 6, 6, 6, 6];
    const chart = buildControlChart(days(series));
    expect(chart.points[13].signal).toBe('run-of-8');
    expect(chart.points[12].signal).toBe('none');
  });

  it('keeps empty days on the axis but out of the limits', () => {
    const chart = buildControlChart(days([10, null, 12, 11, 13, 12, 11, 10, 12]));
    expect(chart.points[1]).toEqual({ date: '2026-10-02', value: null, signal: 'none' });
    expect(chart.center).toBeCloseTo(11.375, 4);
  });

  it('draws no limits below eight points and clamps to the floor', () => {
    const short = buildControlChart(days([1, 2, 3]));
    expect(short.meta.status).toBe('insufficient');
    expect(short.upperLimit).toBeNull();
    const floored = buildControlChart(days([0, 5, 0, 5, 0, 5, 0, 5]), { floor: 0 });
    expect(floored.lowerLimit).toBe(0);
  });
});

describe('queueing', () => {
  it("applies Little's law (L = λW)", () => {
    expect(littlesLaw(18, 246)).toBeCloseTo(1.23, 2);
    expect(littlesLaw(0, 100)).toBe(0);
  });

  it('matches published Erlang C tables (A = 10 Erlangs)', () => {
    expect(erlangC(10, 11)).toBeCloseTo(0.6821, 4);
    expect(erlangC(10, 12)).toBeCloseTo(0.4494, 4);
    expect(erlangC(10, 13)).toBeCloseTo(0.2853, 4);
    expect(erlangC(10, 10)).toBe(1);
  });

  it('computes the service level and the required agents', () => {
    // 200 contacts/h × 180 s = 10 Erlangs; 80% in 20 s needs 14 agents.
    expect(erlangServiceLevel(10, 13, 20, 180)).toBeCloseTo(0.7956, 4);
    expect(erlangServiceLevel(10, 14, 20, 180)).toBeCloseTo(0.8884, 4);
    expect(
      requiredAgents({
        arrivalsPerHour: 200,
        handleSeconds: 180,
        targetSeconds: 20,
        targetShare: 0.8,
      }),
    ).toBe(14);
    // 360/h × 240 s = 24 Erlangs → 29 agents for 80/20.
    expect(
      requiredAgents({
        arrivalsPerHour: 360,
        handleSeconds: 240,
        targetSeconds: 20,
        targetShare: 0.8,
      }),
    ).toBe(29);
  });

  it('needs nobody without load', () => {
    expect(
      requiredAgents({ arrivalsPerHour: 0, handleSeconds: 120, targetSeconds: 300, targetShare: 0.8 }),
    ).toBe(0);
  });
});

describe('run-rate projection', () => {
  it('matches Student-t quantiles', () => {
    expect(tQuantile975(2)).toBeCloseTo(4.303, 3);
    expect(tQuantile975(10)).toBeCloseTo(2.228, 3);
    expect(tQuantile975(60)).toBeCloseTo(2.0, 2);
    expect(tQuantile975(1000)).toBeCloseTo(1.962, 3);
  });

  it('projects the month end with a prediction interval', () => {
    const projection = runRateProjection({
      dailyTotals: [2, 3, 2.5, 3.5, 3],
      spentSoFar: 14,
      remainingDays: 26,
    });
    expect(projection).toEqual({
      expected: 86.8,
      low: 66.71,
      high: 106.89,
      meta: { status: 'ok', sampleSize: 5, minimumSample: 3 },
    });
  });

  it('waits for three days of data', () => {
    expect(runRateProjection({ dailyTotals: [1, 2], spentSoFar: 3, remainingDays: 20 })).toBeNull();
  });
});
