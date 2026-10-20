// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  NotificationEvent,
  NotificationReadEvent,
} from '../../contracts/index';

/**
 * A notification row was stored (`notification:new`) or a grouped row grew
 * (`notification:updated`). Published by the notifications module on the CQRS
 * bus; the conversations module relays it to the recipient's `user:{id}`
 * room only, never to a company-wide audience.
 */
export class NotificationDeliveredEvent {
  constructor(
    public readonly userId: string,
    public readonly kind: 'new' | 'updated',
    public readonly payload: NotificationEvent,
  ) {}
}

/**
 * The reader marked one or all rows read: every tab and device of that user
 * gets `notification:read` so badges never drift apart.
 */
export class NotificationsReadEvent {
  constructor(
    public readonly userId: string,
    public readonly payload: NotificationReadEvent,
  ) {}
}
