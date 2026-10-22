// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  NotificationDataSchema,
  NotificationPreferencesSchema,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationSeverity,
  type NotificationType,
} from '../../contracts/index';
import type { Notification } from './entities/notification.entity';

/** Contract shape of one row: same over REST and socket. */
export function toNotificationItem(row: Notification): NotificationItem {
  const data = NotificationDataSchema.safeParse(row.data ?? {});

  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type as NotificationType,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body ?? null,
    data: data.success ? data.data : {},
    groupKey: row.groupKey ?? null,
    count: row.count,
    readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt ?? row.createdAt).toISOString(),
  };
}

/**
 * Stored prefs predate `desktop` (`{ muted }` only): parsing fills the
 * defaults, and garbage falls back to nothing muted.
 */
export function readPreferences(raw: unknown): NotificationPreferences {
  const parsed = NotificationPreferencesSchema.safeParse(raw ?? {});

  return parsed.success
    ? parsed.data
    : NotificationPreferencesSchema.parse({});
}
