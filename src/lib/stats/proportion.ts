// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { Interval, RateEstimate } from '../../contracts/index';
import { SHRINKAGE_MIN_AGENTS } from '../../contracts/index';
import { mean } from './descriptive';
import { clamp01, round, sufficiency } from './sufficiency';

/** Two-sided 95% standard normal quantile. */
export const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion (Wilson 1927). Unlike the
 * Wald interval it stays inside [0, 1] and keeps its coverage for small
 * samples and rates near 0 or 1 — the normal case for one agent's week.
 * `null` without trials.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = Z_95,
): Interval | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) /
    denominator;
  return { low: clamp01(center - half), high: clamp01(center + half) };
}

/** A proportion with its Wilson interval; `adjusted` is filled by shrinkage. */
export function rateEstimate(
  successes: number,
  trials: number,
  minimumSample = 1,
): RateEstimate {
  const interval = wilsonInterval(successes, trials);
  return {
    value: trials > 0 ? round(clamp01(successes / trials)) : null,
    successes,
    trials,
    interval: interval
      ? { low: round(interval.low), high: round(interval.high) }
      : null,
    adjusted: null,
    meta: sufficiency(trials, minimumSample),
  };
}

export interface BetaPrior {
  alpha: number;
  beta: number;
}

/**
 * Empirical-Bayes beta-binomial prior by the method of moments.
 *
 * Observed rates spread for two reasons: binomial noise (large when `n` is
 * small) and real differences between agents (τ²). Subtracting the expected
 * noise `m(1 − m)·mean(1/nᵢ)` from the observed variance of the rates leaves
 * τ²; a Beta(α, β) with mean `m` and that variance is the prior. When τ² is
 * not positive the agents are indistinguishable from noise and every rate
 * shrinks to the pooled mean (the prior gets a very large weight).
 *
 * `null` with fewer than `SHRINKAGE_MIN_AGENTS` groups that have trials, or
 * when the pooled rate is exactly 0 or 1 (no spread to estimate).
 */
export function estimateBetaPrior(
  groups: readonly { successes: number; trials: number }[],
  minimumGroups = SHRINKAGE_MIN_AGENTS,
): BetaPrior | null {
  const observed = groups.filter((group) => group.trials > 0);
  if (observed.length < minimumGroups) return null;

  const rates = observed.map((group) => group.successes / group.trials);
  const m = mean(rates) as number;
  if (m <= 0 || m >= 1) return null;

  const variance =
    rates.reduce((sum, rate) => sum + (rate - m) ** 2, 0) / (rates.length - 1);
  const noise =
    m * (1 - m) * (mean(observed.map((group) => 1 / group.trials)) as number);
  const tau2 = variance - noise;

  // No real spread beyond noise: shrink everything to the pooled mean.
  const pooled =
    observed.reduce((sum, group) => sum + group.successes, 0) /
    observed.reduce((sum, group) => sum + group.trials, 0);
  if (!(tau2 > 0)) {
    const strength = 1e6;
    return { alpha: pooled * strength, beta: (1 - pooled) * strength };
  }

  const strength = Math.max((m * (1 - m)) / tau2 - 1, 1e-6);
  return { alpha: m * strength, beta: (1 - m) * strength };
}

/** Posterior mean `(s + α) / (n + α + β)`. */
export function shrinkRate(
  successes: number,
  trials: number,
  prior: BetaPrior,
): number {
  return (successes + prior.alpha) / (trials + prior.alpha + prior.beta);
}

/**
 * Fills `adjusted` on each estimate with its empirical-Bayes shrunk rate.
 * Leaves `adjusted: null` everywhere when the prior cannot be estimated.
 */
export function withShrinkage(estimates: RateEstimate[]): RateEstimate[] {
  const prior = estimateBetaPrior(estimates);
  if (!prior) return estimates;

  return estimates.map((estimate) => ({
    ...estimate,
    adjusted:
      estimate.trials > 0
        ? round(clamp01(shrinkRate(estimate.successes, estimate.trials, prior)))
        : null,
  }));
}
