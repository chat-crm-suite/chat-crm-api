// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { AssignmentCandidate } from './assignment.types';

/**
 * Reglas de selección del motor, en función pura para testear sin BD:
 * 1. Solo candidatos por debajo del tope (`maxOpen <= 0` = sin tope).
 * 2. Sticky: el agente anterior gana si sigue elegible.
 * 3. Menor carga; desempate por asignación más antigua y orden estable por id.
 */
export function selectAssignmentCandidate(
  candidates: AssignmentCandidate[],
  maxOpen: number,
  stickyMemberId?: string | null,
): AssignmentCandidate | null {
  const eligible =
    maxOpen > 0
      ? candidates.filter((candidate) => candidate.load < maxOpen)
      : candidates;

  if (eligible.length === 0) return null;

  if (stickyMemberId) {
    const sticky = eligible.find(
      (candidate) => candidate.memberId === stickyMemberId,
    );
    if (sticky) return sticky;
  }

  return eligible.reduce((best, current) => {
    if (current.load !== best.load) {
      return current.load < best.load ? current : best;
    }

    const currentTime = current.lastAssignedAt?.getTime() ?? 0;
    const bestTime = best.lastAssignedAt?.getTime() ?? 0;
    if (currentTime !== bestTime) {
      return currentTime < bestTime ? current : best;
    }

    return current.memberId < best.memberId ? current : best;
  });
}
