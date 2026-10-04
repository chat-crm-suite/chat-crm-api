import { AssignmentCandidate } from './assignment.types';
import { selectAssignmentCandidate } from './assignment.selection';

const candidate = (
  agentId: string,
  load: number,
  lastAssignedAt: Date | null = null,
): AssignmentCandidate => ({ agentId, load, lastAssignedAt });

describe('selectAssignmentCandidate', () => {
  it('returns null when there are no candidates', () => {
    expect(selectAssignmentCandidate([], 10)).toBeNull();
  });

  it('returns null when every candidate is at the cap', () => {
    const candidates = [candidate('a', 10), candidate('b', 12)];

    expect(selectAssignmentCandidate(candidates, 10)).toBeNull();
  });

  it('picks the lowest load', () => {
    const candidates = [candidate('a', 3), candidate('b', 1), candidate('c', 2)];

    expect(selectAssignmentCandidate(candidates, 10)?.agentId).toBe('b');
  });

  it('breaks ties by least recent assignment (never assigned wins)', () => {
    const candidates = [
      candidate('a', 1, new Date('2026-09-01T10:00:00Z')),
      candidate('b', 1, new Date('2026-08-01T10:00:00Z')),
      candidate('c', 1, null),
    ];

    expect(selectAssignmentCandidate(candidates, 10)?.agentId).toBe('c');
  });

  it('is deterministic for identical candidates', () => {
    const candidates = [candidate('b', 0), candidate('a', 0)];

    expect(selectAssignmentCandidate(candidates, 10)?.agentId).toBe('a');
  });

  it('prefers the sticky agent when eligible, even with higher load', () => {
    const candidates = [candidate('a', 0), candidate('b', 4)];

    expect(selectAssignmentCandidate(candidates, 10, 'b')?.agentId).toBe('b');
  });

  it('falls back to least load when the sticky agent is at the cap', () => {
    const candidates = [candidate('a', 0), candidate('b', 10)];

    expect(selectAssignmentCandidate(candidates, 10, 'b')?.agentId).toBe('a');
  });

  it('ignores sticky when there is no history', () => {
    const candidates = [candidate('a', 2), candidate('b', 1)];

    expect(selectAssignmentCandidate(candidates, 10, null)?.agentId).toBe('b');
  });

  it('treats maxChats <= 0 as unlimited', () => {
    const candidates = [candidate('a', 99)];

    expect(selectAssignmentCandidate(candidates, 0)?.agentId).toBe('a');
  });
});
