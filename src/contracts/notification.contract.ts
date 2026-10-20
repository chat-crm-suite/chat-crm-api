// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import type { MemberRole } from './member.contract';

/**
 * Notification types (`notifications.type`) and per-member preferences.
 * Every producer goes through the notification dispatcher with one of these
 * strings; muting is applied at delivery, so a muted type is never stored
 * nor emitted.
 */
export const NOTIFICATION_TYPES = [
  'conversation_assigned',
  'conversation_message',
  'queue_unassigned',
  'task_assigned',
  'task_due',
  'channel_down',
  'ia_down',
  'spend_budget',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** Drives the toast variant, the bell icon and whether the toast persists. */
export const NOTIFICATION_SEVERITIES = [
  'info',
  'success',
  'warning',
  'critical',
] as const;
export const NotificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/**
 * Which roles may ever receive each type. The dispatcher still narrows the
 * audience per event (e.g. only the assignee), this is the upper bound: the
 * settings screen lists only the types allowed for the member's role.
 */
export const NOTIFICATION_AUDIENCE: Record<
  NotificationType,
  readonly MemberRole[]
> = {
  conversation_assigned: ['admin', 'supervisor', 'agent'],
  conversation_message: ['admin', 'supervisor', 'agent'],
  queue_unassigned: ['admin', 'supervisor'],
  task_assigned: ['admin', 'supervisor', 'agent'],
  task_due: ['admin', 'supervisor', 'agent'],
  channel_down: ['admin'],
  ia_down: ['admin'],
  spend_budget: ['admin'],
};

/**
 * Group of everything about one conversation (assigned, new messages): the
 * bell collapses repeats of one type, and opening the chat reads them all.
 */
export const conversationGroupKey = (conversationId: string) =>
  `conversation:${conversationId}`;

/** Deep-link targets; the front builds the URL from these ids. */
export const NotificationDataSchema = z.object({
  conversationId: z.string().optional(),
  taskId: z.string().optional(),
  channelId: z.string().optional(),
});
export type NotificationData = z.infer<typeof NotificationDataSchema>;

/**
 * One bell item. Same shape over REST and socket. Bursts collapse into one
 * unread row per type and `groupKey` (e.g. `conversation:<id>`): `count`
 * grows and `title`/`body` are refreshed instead of stacking new rows.
 */
export const NotificationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  type: NotificationTypeSchema,
  severity: NotificationSeveritySchema,
  title: z.string(),
  body: z.string().nullable(),
  data: NotificationDataSchema,
  groupKey: z.string().nullable(),
  count: z.number().int().min(1),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NotificationItem = z.infer<typeof NotificationSchema>;

/**
 * `GET /notifications`. Ids are UUIDv7 (time-ordered): `after` returns only
 * newer rows (reconnect replay), `before` pages older ones (bell scroll).
 */
export const NotificationListQuerySchema = z.object({
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int().min(0),
  /** Pass as `before` to load older rows; null = no more. */
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;

/** `GET /notifications/unread-count`. */
export const NotificationUnreadCountSchema = z.object({
  unreadCount: z.number().int().min(0),
});

/**
 * Socket `notification:new` (new row) and `notification:updated` (a grouped
 * row grew), sent only to `user:<id>`. Carries the recipient's unread count
 * for that company so every tab sets the badge instead of guessing.
 */
export const NotificationEventSchema = z.object({
  notification: NotificationSchema,
  unreadCount: z.number().int().min(0),
});
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

/**
 * `POST /notifications/read`: no body (or `{}`) = all; `conversationId` =
 * only the unread rows about that conversation (the chat was opened).
 */
export const NotificationMarkReadSchema = z.object({
  conversationId: z.string().optional(),
});
export type NotificationMarkRead = z.infer<typeof NotificationMarkReadSchema>;

/**
 * Socket `notification:read`: echoed to every tab/device of the reader after
 * `POST /notifications/:id/read` or `POST /notifications/read` (all).
 */
export const NotificationReadEventSchema = z.object({
  companyId: z.string(),
  ids: z.union([z.array(z.string()), z.literal('all')]),
  unreadCount: z.number().int().min(0),
});
export type NotificationReadEvent = z.infer<typeof NotificationReadEventSchema>;

/**
 * `GET/PUT /notifications/preferences` (per company member).
 * - `muted`: never stored nor delivered.
 * - `desktop`: may also show an OS notification while the tab is hidden.
 * Sound and the browser permission stay local to each browser.
 */
export const NotificationPreferencesSchema = z.object({
  muted: z.array(NotificationTypeSchema).default([]),
  desktop: z
    .array(NotificationTypeSchema)
    .default(['conversation_assigned', 'conversation_message', 'task_assigned']),
});
export type NotificationPreferences = z.infer<
  typeof NotificationPreferencesSchema
>;
