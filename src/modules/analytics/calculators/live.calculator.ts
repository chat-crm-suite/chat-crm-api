// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  AgentFloorRow,
  LiveSnapshot,
  PresenceState,
  QueuePressure,
  SlaState,
  WaitingCustomer,
} from '@contracts';
import { LIVE_WAITING_LIMIT, PERCENTILE_MIN_SAMPLE } from '@contracts';
import { businessSeconds } from '@lib/business-time';
import { littlesLaw, median, round, sufficiency } from '@lib/stats/index';
import type { CaseRow, MeasureContext, MemberRow, ToneRow } from '../analytics.types';

/** A wait turns `risk` at 80 % of the SLA and `breach` past it. */
export const SLA_RISK_SHARE = 0.8;

export interface LiveInput {
  context: MeasureContext;
  members: MemberRow[];
  openCases: CaseRow[];
  /** Cases opened in the last hour (arrival rate λ). */
  arrivalsLastHour: number;
  /** Wall-clock waits (s) of cases first-answered in the last hour. */
  recentWaits: number[];
  /** Cases first-answered today, for each agent's median of the day. */
  answeredToday: CaseRow[];
  presence: Map<string, { state: PresenceState; since: Date | null }>;
  /** Today's analyzed inbound messages; null while the IA is unavailable. */
  toneToday: ToneRow[] | null;
}

export function slaStateOf(businessWait: number, slaSeconds: number): SlaState {
  if (businessWait > slaSeconds) return 'breach';
  if (businessWait >= slaSeconds * SLA_RISK_SHARE) return 'risk';
  return 'ok';
}

/**
 * Queue trend from Little's law: with λ arrivals/hour and median wait W the
 * stable queue holds `L = λW`. The observed queue is compared against a
 * Poisson-style band `L ± 2√L`; beyond it the queue is building/draining.
 */
export function queueTrend(observed: number, expected: number): QueuePressure['trend'] {
  const band = 2 * Math.sqrt(Math.max(expected, 0)) + 1;
  if (observed > expected + band) return 'building';
  if (observed < expected - band) return 'draining';
  return 'stable';
}

/** Company-wide floor snapshot; role shaping happens in `shapeLiveSnapshot`. */
export function computeLiveSnapshot(input: LiveInput): LiveSnapshot {
  const { context } = input;
  const now = context.now;
  const names = new Map(input.members.map((m) => [m.memberId, m.displayName]));

  const waitingAll: WaitingCustomer[] = input.openCases
    .filter((row) => row.awaitingReplySince !== null)
    .map((row) => {
      const since = row.awaitingReplySince as number;
      const assignee = row.assignedMemberId;
      return {
        caseId: row.id,
        conversationId: row.conversationId,
        channelType: row.channelType,
        customer: { id: row.customerId, displayName: row.customerName },
        assignee: assignee
          ? { memberId: assignee, displayName: names.get(assignee) ?? 'Miembro' }
          : null,
        waitingSince: new Date(since),
        waitingSeconds: round(Math.max(0, (now - since) / 1000), 0),
        slaState: slaStateOf(businessSeconds(since, now, context.hours), context.slaSeconds),
      };
    })
    .sort((a, b) => b.waitingSeconds - a.waitingSeconds);

  const unassignedOpen = input.openCases.filter((row) => !row.assignedMemberId);
  const unassignedWaiting = waitingAll.filter((row) => !row.assignee);

  const medianWait = median(input.recentWaits);
  const expected =
    medianWait === null ? null : littlesLaw(input.arrivalsLastHour, medianWait);
  const queuePressure: QueuePressure = {
    arrivalsPerHour: input.arrivalsLastHour,
    medianWaitSeconds: round(medianWait, 0),
    expectedQueueLength: expected === null ? null : round(expected, 2),
    observedQueueLength: waitingAll.length,
    trend: expected === null ? 'stable' : queueTrend(waitingAll.length, expected),
    meta: sufficiency(input.recentWaits.length, PERCENTILE_MIN_SAMPLE),
  };

  const agents = floorRows(input, waitingAll);

  return {
    generatedAt: new Date(now),
    slaSeconds: context.slaSeconds,
    waiting: waitingAll,
    waitingTotal: waitingAll.length,
    queue: {
      unassignedCount: unassignedOpen.length,
      oldestWaitingSeconds: unassignedWaiting[0]?.waitingSeconds ?? null,
    },
    queuePressure,
    agents,
    me: null,
  };
}

function floorRows(input: LiveInput, waiting: WaitingCustomer[]): AgentFloorRow[] {
  const { context } = input;

  return input.members
    .filter((member) => {
      const openCases = input.openCases.some((row) => row.assignedMemberId === member.memberId);
      return member.role === 'agent' || openCases;
    })
    .map((member) => {
      const id = member.memberId;
      const mine = waiting.filter((row) => row.assignee?.memberId === id);
      const presence = input.presence.get(id) ?? { state: 'offline' as const, since: null };
      const answered = input.answeredToday
        .filter((row) => row.firstResponderMemberId === id && row.firstResponseAt !== null)
        .map((row) => businessSeconds(row.openedAt, row.firstResponseAt as number, context.hours));
      const tone = input.toneToday?.filter((row) => row.ownerMemberId === id) ?? null;

      return {
        memberId: id,
        displayName: member.displayName,
        role: member.role,
        presence: presence.state,
        presenceSince: presence.since,
        openCases: input.openCases.filter((row) => row.assignedMemberId === id).length,
        capacity: member.capacity ?? context.defaultCapacity,
        waitingCount: mine.length,
        oldestWaitingSeconds: mine[0]?.waitingSeconds ?? null,
        firstResponseTodayMedian: round(median(answered), 0),
        negativeToneShare:
          tone && tone.length
            ? round(tone.filter((row) => row.label === 'negative').length / tone.length)
            : null,
      };
    });
}

/**
 * Agents see their own waiting customers, the unassigned queue counters and
 * their own row; supervisors and admins see the whole floor.
 */
export function shapeLiveSnapshot(
  snapshot: LiveSnapshot,
  viewer: { memberId: string; role: string },
): LiveSnapshot {
  const me = snapshot.agents.find((row) => row.memberId === viewer.memberId) ?? null;
  const limited = (rows: WaitingCustomer[]) => rows.slice(0, LIVE_WAITING_LIMIT);

  if (viewer.role === 'agent') {
    const own = snapshot.waiting.filter((row) => row.assignee?.memberId === viewer.memberId);
    return {
      ...snapshot,
      waiting: limited(own),
      waitingTotal: own.length,
      queuePressure: null,
      agents: [],
      me,
    };
  }

  return { ...snapshot, waiting: limited(snapshot.waiting), me };
}
