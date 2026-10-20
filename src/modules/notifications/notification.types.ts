// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  MemberRole,
  NotificationData,
  NotificationSeverity,
  NotificationType,
} from '../../contracts/index';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const DELIVER_JOB = 'deliver';

/** Default dedupe window: the same event never notifies twice within it. */
export const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Who should get it. Always intersected with `NOTIFICATION_AUDIENCE[type]`
 * and the company's active members, so a producer can never widen it.
 */
export type NotificationAudience =
  | { memberIds: string[] }
  | { roles: MemberRole[] };

/** `NotificationDispatcher.notify` input, also the queued job payload. */
export interface NotifyInput {
  companyId: string;
  type: NotificationType;
  audience: NotificationAudience;
  title: string;
  body?: string | null;
  data?: NotificationData;
  /** Defaults per type (`DEFAULT_SEVERITY`). */
  severity?: NotificationSeverity;
  /**
   * Identity of the event (e.g. `assigned:<conversationId>:<assignmentId>`):
   * the same key never reaches the same member twice within the window.
   */
  dedupeKey: string;
  dedupeTtlMs?: number;
  /** Unread rows with the same key collapse into one whose `count` grows. */
  groupKey?: string;
  /** The member who caused it never hears about their own action. */
  excludeMemberIds?: string[];
}

export const DEFAULT_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  conversation_assigned: 'info',
  conversation_message: 'info',
  queue_unassigned: 'warning',
  task_assigned: 'info',
  task_due: 'warning',
  channel_down: 'critical',
  ia_down: 'warning',
  spend_budget: 'warning',
};
