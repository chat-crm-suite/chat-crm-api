// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import {
  NotificationDeliveredEvent,
  NotificationsReadEvent,
} from '@common/events/notification-realtime.event';
import { ConversationSocketEvent } from '@contracts';
import { ConversationGateway, userRoom } from '../gateways/conversation.gateway';

/**
 * Relays a delivered notification to its recipient's `user:{id}` room only:
 * every tab and device of that user, nobody else. With the Redis adapter the
 * emit reaches sockets held by any API process.
 */
@EventsHandler(NotificationDeliveredEvent)
export class NotificationDeliveredHandler
  implements IEventHandler<NotificationDeliveredEvent>
{
  constructor(private readonly gateway: ConversationGateway) {}

  handle({ userId, kind, payload }: NotificationDeliveredEvent): void {
    const event =
      kind === 'new'
        ? ConversationSocketEvent.NewNotification
        : ConversationSocketEvent.NotificationUpdated;

    this.gateway.server?.to(userRoom(userId)).emit(event, payload);
  }
}

/** Read state echo, so other tabs clear the same rows and badge. */
@EventsHandler(NotificationsReadEvent)
export class NotificationsReadHandler implements IEventHandler<NotificationsReadEvent> {
  constructor(private readonly gateway: ConversationGateway) {}

  handle({ userId, payload }: NotificationsReadEvent): void {
    this.gateway.server
      ?.to(userRoom(userId))
      .emit(ConversationSocketEvent.NotificationRead, payload);
  }
}
