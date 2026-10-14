// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  BusinessHours,
  CaseStatus,
  ChannelFilter,
  ChannelType,
  MemberRole,
  SentimentLabel,
} from '../../contracts/index';

/** Instants (ms) bounding an analytics range; `to` is exclusive. */
export interface TimeRange {
  from: number;
  to: number;
}

/** What every calculator needs to measure on the company clock. */
export interface MeasureContext {
  companyId: string;
  channel: ChannelFilter;
  timezone: string;
  hours: BusinessHours | null;
  slaSeconds: number;
  targetShare: number;
  /** Default per-agent capacity (`auto_assign_max_open`), null = unlimited. */
  defaultCapacity: number | null;
  now: number;
}

export interface MemberRow {
  memberId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  capacity: number | null;
}

export interface CaseRow {
  id: string;
  conversationId: string;
  customerId: string;
  customerName: string | null;
  channelType: ChannelType;
  status: CaseStatus;
  openedAt: number;
  firstResponseAt: number | null;
  firstResponderMemberId: string | null;
  awaitingReplySince: number | null;
  closedAt: number | null;
  ownerMemberId: string | null;
  reopenOfCaseId: string | null;
  inboundCount: number;
  outboundCount: number;
  /** Current assignee of the conversation (live owner of open cases). */
  assignedMemberId: string | null;
}

export interface ReplyRow {
  memberId: string | null;
  awaitedFrom: number;
  repliedAt: number;
  isFirst: boolean;
}

export interface TransferRow {
  fromMemberId: string;
  toMemberId: string;
  at: number;
}

export interface PresenceRow {
  memberId: string;
  state: 'available' | 'away';
  startedAt: number;
  endedAt: number | null;
}

export interface ToneRow {
  at: number;
  label: SentimentLabel;
  /** Member owning the case the message belongs to, when known. */
  ownerMemberId: string | null;
}

/** Owner of a case: who held it at close, else its current assignee. */
export const caseOwner = (row: CaseRow): string | null =>
  row.ownerMemberId ?? row.assignedMemberId ?? row.firstResponderMemberId ?? null;
