// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Notification types (`notifications.type`) and per-member preferences.
 * Every producer must use one of these strings; muting is applied where the
 * notification is created, so a muted type is never stored nor emitted.
 */
export const NOTIFICATION_TYPES = [
  'conversation_assigned',
  'queue_unassigned',
  'spend_budget',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** `GET/PUT /company-members/me/notification-prefs`. */
export const NotificationPreferencesSchema = z.object({
  muted: z.array(NotificationTypeSchema).default([]),
});
export type NotificationPreferences = z.infer<
  typeof NotificationPreferencesSchema
>;
