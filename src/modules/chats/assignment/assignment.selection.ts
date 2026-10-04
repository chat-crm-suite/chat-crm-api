import { AssignmentCandidate } from './assignment.types';

/**
 * Reglas de selección del motor (Q2/Q5), en función pura para testear sin BD:
 * 1. Solo candidatos por debajo del tope (`maxChats <= 0` = sin tope).
 * 2. Sticky: el agente anterior gana si sigue elegible (Q5).
 * 3. Menor carga; desempate por asignación más antigua y orden estable por id.
 */
export function selectAssignmentCandidate(
  candidates: AssignmentCandidate[],
  maxChats: number,
  stickyAgentId?: string | null,
): AssignmentCandidate | null {
  const eligible =
    maxChats > 0 ? candidates.filter((candidate) => candidate.load < maxChats) : candidates;

  if (eligible.length === 0) return null;

  if (stickyAgentId) {
    const sticky = eligible.find((candidate) => candidate.agentId === stickyAgentId);
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

    return current.agentId < best.agentId ? current : best;
  });
}
