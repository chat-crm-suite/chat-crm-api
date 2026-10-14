// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  AgentPerformance,
  ControlChart,
  ControlMetric,
  RateEstimate,
  TeamReference,
} from '@contracts';
import { PERCENTILE_MIN_SAMPLE } from '@contracts';
import { businessSeconds } from '@lib/business-time';
import {
  buildControlChart,
  median,
  rateEstimate,
  round,
  sufficiency,
  summarizeDurations,
  withShrinkage,
} from '@lib/stats/index';
import { zonedDateKey, zonedDateKeys } from '@lib/zoned-time';
import {
  caseOwner,
  type CaseRow,
  type MeasureContext,
  type MemberRow,
  type PresenceRow,
  type ReplyRow,
  type TimeRange,
  type ToneRow,
  type TransferRow,
} from '../analytics.types';
import { clip, overlapSeconds, totalSeconds, type Span } from './intervals';

export interface PerformanceInput {
  context: MeasureContext;
  range: TimeRange;
  members: MemberRow[];
  cases: CaseRow[];
  replies: ReplyRow[];
  transfers: TransferRow[];
  presence: PresenceRow[];
  /** Null while the sentiment IA is unavailable. */
  tone: ToneRow[] | null;
  reopenedIds: Set<string>;
}

/** Per-member samples, reused by the table, the team reference and charts. */
export interface MemberSamples {
  member: MemberRow;
  /** First responses this member gave to cases opened in the range. */
  firstResponses: { at: number; seconds: number }[];
  replySeconds: number[];
  resolved: CaseRow[];
  handled: CaseRow[];
  transfersOut: number;
  tone: ToneRow[];
}

const within = (instant: number | null, range: TimeRange) =>
  instant !== null && instant >= range.from && instant < range.to;

/** Splits the range data by member (owner / responder / replier). */
export function collectSamples(input: PerformanceInput): MemberSamples[] {
  const { context, range } = input;
  const hours = context.hours;

  return input.members.map((member) => {
    const id = member.memberId;
    const openedHere = input.cases.filter((row) => within(row.openedAt, range));

    return {
      member,
      firstResponses: openedHere
        .filter((row) => row.firstResponderMemberId === id && row.firstResponseAt !== null)
        .map((row) => ({
          at: row.openedAt,
          seconds: businessSeconds(row.openedAt, row.firstResponseAt as number, hours),
        })),
      replySeconds: input.replies
        .filter((reply) => reply.memberId === id)
        .map((reply) => businessSeconds(reply.awaitedFrom, reply.repliedAt, hours)),
      resolved: input.cases.filter(
        (row) => row.status === 'closed' && within(row.closedAt, range) && row.ownerMemberId === id,
      ),
      handled: openedHere.filter((row) => caseOwner(row) === id),
      transfersOut: input.transfers.filter((transfer) => transfer.fromMemberId === id).length,
      tone: (input.tone ?? []).filter((row) => row.ownerMemberId === id),
    };
  });
}

/**
 * Builds every member's performance row. Rates carry Wilson intervals and,
 * across members, the empirical-Bayes adjusted value (fair comparisons when
 * volumes differ). No composite score: each dimension stands on its own.
 */
export function computePerformance(input: PerformanceInput): {
  rows: AgentPerformance[];
  samples: MemberSamples[];
} {
  const { context, range } = input;
  const samples = collectSamples(input);

  const rows = samples.map((sample): AgentPerformance => {
    const id = sample.member.memberId;
    const presence = input.presence.filter((row) => row.memberId === id);
    const toSpan = (row: PresenceRow): Span => ({
      start: row.startedAt,
      end: row.endedAt ?? context.now,
    });
    const connected = clip(presence.map(toSpan), range.from, range.to);
    const available = clip(
      presence.filter((row) => row.state === 'available').map(toSpan),
      range.from,
      range.to,
    );
    const busy = clip(
      input.cases
        .filter((row) => caseOwner(row) === id)
        .map((row) => ({ start: row.openedAt, end: row.closedAt ?? context.now })),
      range.from,
      range.to,
    );
    const availableSeconds = totalSeconds(available);

    const withinSla = sample.firstResponses.filter((r) => r.seconds <= context.slaSeconds).length;
    const reopened = sample.resolved.filter((row) => input.reopenedIds.has(row.id)).length;
    const negative = sample.tone.filter((row) => row.label === 'negative').length;

    return {
      memberId: id,
      displayName: sample.member.displayName,
      role: sample.member.role,
      handledCases: sample.handled.length,
      resolvedCases: sample.resolved.length,
      connectedSeconds: round(totalSeconds(connected), 0),
      availableSeconds: round(availableSeconds, 0),
      occupancy:
        availableSeconds > 0
          ? round(Math.min(1, overlapSeconds(busy, available) / availableSeconds))
          : null,
      firstResponse: summarizeDurations(sample.firstResponses.map((r) => r.seconds)),
      replyTime: summarizeDurations(sample.replySeconds),
      resolutionTime: summarizeDurations(
        sample.resolved.map((row) => businessSeconds(row.openedAt, row.closedAt as number, context.hours)),
      ),
      serviceLevel: rateEstimate(withinSla, sample.firstResponses.length),
      reopenRate: rateEstimate(reopened, sample.resolved.length),
      transferRate: rateEstimate(sample.transfersOut, sample.handled.length + sample.transfersOut),
      messagesPerCase: {
        inboundMedian: round(median(sample.resolved.map((row) => row.inboundCount)), 1),
        outboundMedian: round(median(sample.resolved.map((row) => row.outboundCount)), 1),
        meta: sufficiency(sample.resolved.length, PERCENTILE_MIN_SAMPLE),
      },
      negativeTone: input.tone ? rateEstimate(negative, sample.tone.length) : null,
    };
  });

  return { rows: applyShrinkage(rows), samples };
}

/** Cross-member shrinkage of every rate (left untouched below 3 members). */
function applyShrinkage(rows: AgentPerformance[]): AgentPerformance[] {
  const shrink = (pick: (row: AgentPerformance) => RateEstimate | null) => {
    const indexes = rows.map((row, i) => (pick(row) ? i : -1)).filter((i) => i >= 0);
    const adjusted = withShrinkage(indexes.map((i) => pick(rows[i]) as RateEstimate));
    const result = new Map<number, RateEstimate>();
    indexes.forEach((rowIndex, k) => result.set(rowIndex, adjusted[k]));
    return result;
  };

  const serviceLevel = shrink((row) => row.serviceLevel);
  const reopenRate = shrink((row) => row.reopenRate);
  const transferRate = shrink((row) => row.transferRate);
  const negativeTone = shrink((row) => row.negativeTone);

  return rows.map((row, i) => ({
    ...row,
    serviceLevel: serviceLevel.get(i) ?? row.serviceLevel,
    reopenRate: reopenRate.get(i) ?? row.reopenRate,
    transferRate: transferRate.get(i) ?? row.transferRate,
    negativeTone: row.negativeTone ? (negativeTone.get(i) ?? row.negativeTone) : null,
  }));
}

/** True when the member did anything measurable in the range. */
export const hasActivity = (row: AgentPerformance) =>
  row.handledCases > 0 ||
  row.resolvedCases > 0 ||
  row.firstResponse.meta.sampleSize > 0 ||
  row.replyTime.meta.sampleSize > 0 ||
  row.connectedSeconds > 0;

/** Anonymous reference: medians across members with data, no names. */
export function teamReference(rows: AgentPerformance[]): TeamReference {
  const active = rows.filter(hasActivity);
  const medianOf = (values: (number | null)[]) =>
    round(median(values.filter((v): v is number => v !== null)), 4);

  return {
    agentCount: active.length,
    firstResponseMedian: medianOf(active.map((row) => row.firstResponse.median)),
    firstResponseP90: medianOf(active.map((row) => row.firstResponse.p90)),
    serviceLevel: medianOf(active.map((row) => row.serviceLevel.value)),
    resolutionTimeMedian: medianOf(active.map((row) => row.resolutionTime.median)),
    reopenRate: medianOf(active.map((row) => row.reopenRate.value)),
  };
}

/** Daily XmR chart of one member's metric over the range. */
export function memberControlChart(
  metric: ControlMetric,
  sample: MemberSamples,
  context: MeasureContext,
  range: TimeRange,
): ControlChart {
  const days = zonedDateKeys(range.from, range.to - 1, context.timezone);
  const byDay = <T>(items: T[], at: (item: T) => number) => {
    const groups = new Map<string, T[]>(days.map((day) => [day, []]));
    for (const item of items) {
      groups.get(zonedDateKey(at(item), context.timezone))?.push(item);
    }
    return groups;
  };

  switch (metric) {
    case 'first-response': {
      const groups = byDay(sample.firstResponses, (r) => r.at);
      return buildControlChart(
        days.map((date) => ({
          date,
          value: median((groups.get(date) ?? []).map((r) => r.seconds)),
        })),
        { floor: 0, digits: 1 },
      );
    }
    case 'service-level': {
      const groups = byDay(sample.firstResponses, (r) => r.at);
      return buildControlChart(
        days.map((date) => {
          const day = groups.get(date) ?? [];
          return {
            date,
            value: day.length
              ? day.filter((r) => r.seconds <= context.slaSeconds).length / day.length
              : null,
          };
        }),
        { floor: 0, ceiling: 1 },
      );
    }
    case 'resolved-cases': {
      const groups = byDay(sample.resolved, (row) => row.closedAt as number);
      return buildControlChart(
        days.map((date) => ({ date, value: (groups.get(date) ?? []).length })),
        { floor: 0, digits: 2 },
      );
    }
    case 'negative-tone': {
      const groups = byDay(sample.tone, (row) => row.at);
      return buildControlChart(
        days.map((date) => {
          const day = groups.get(date) ?? [];
          return {
            date,
            value: day.length ? day.filter((row) => row.label === 'negative').length / day.length : null,
          };
        }),
        { floor: 0, ceiling: 1 },
      );
    }
  }
}
