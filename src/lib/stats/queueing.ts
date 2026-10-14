// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/** Agents are searched up to this many; beyond it the load is not staffable. */
export const MAX_AGENTS = 500;

/**
 * Little's law: average number in the system `L = λ·W` for any stable queue,
 * whatever the arrival or service distributions. `λ` in arrivals per hour,
 * `W` in seconds.
 */
export function littlesLaw(arrivalsPerHour: number, waitSeconds: number): number {
  if (!(arrivalsPerHour > 0) || !(waitSeconds > 0)) return 0;
  return (arrivalsPerHour / 3600) * waitSeconds;
}

/** Offered load in Erlangs: `A = λ·AHT`. */
export function offeredLoad(arrivalsPerHour: number, handleSeconds: number): number {
  if (!(arrivalsPerHour > 0) || !(handleSeconds > 0)) return 0;
  return (arrivalsPerHour / 3600) * handleSeconds;
}

/** Erlang B blocking probability, by the stable recurrence on `N`. */
export function erlangB(load: number, agents: number): number {
  let blocking = 1;
  for (let k = 1; k <= agents; k++) {
    blocking = (load * blocking) / (k + load * blocking);
  }
  return blocking;
}

/**
 * Erlang C: probability that an arrival has to wait (M/M/N queue). With
 * `N ≤ A` the queue never stabilizes and every arrival waits.
 */
export function erlangC(load: number, agents: number): number {
  if (load <= 0) return 0;
  if (agents <= load) return 1;
  const blocking = erlangB(load, agents);
  return (agents * blocking) / (agents - load * (1 - blocking));
}

/**
 * Share of arrivals answered within `targetSeconds`:
 * `SL = 1 − C(N, A)·e^(−(N − A)·T / AHT)`.
 */
export function erlangServiceLevel(
  load: number,
  agents: number,
  targetSeconds: number,
  handleSeconds: number,
): number {
  if (load <= 0) return 1;
  if (agents <= load) return 0;
  const wait = erlangC(load, agents);
  return 1 - wait * Math.exp((-(agents - load) * targetSeconds) / handleSeconds);
}

/**
 * Minimum agents that meet `targetShare` answered within `targetSeconds`
 * (Erlang C). 0 with no load; `null` when it is not reachable under
 * `MAX_AGENTS`.
 */
export function requiredAgents(input: {
  arrivalsPerHour: number;
  handleSeconds: number;
  targetSeconds: number;
  targetShare: number;
}): number | null {
  const load = offeredLoad(input.arrivalsPerHour, input.handleSeconds);
  if (load <= 0) return 0;

  for (let agents = Math.max(1, Math.floor(load) + 1); agents <= MAX_AGENTS; agents++) {
    const level = erlangServiceLevel(
      load,
      agents,
      input.targetSeconds,
      input.handleSeconds,
    );
    if (level >= input.targetShare) return agents;
  }
  return null;
}
