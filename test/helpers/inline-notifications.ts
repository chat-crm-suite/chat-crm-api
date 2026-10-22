// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { EventBus } from '@nestjs/cqrs';
import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import {
  NotificationDeliveredEvent,
  NotificationsReadEvent,
} from '../../src/common/events/notification-realtime.event';
import type { AppRedis } from '../../src/common/redis/app-redis.module';
import { CompanyMember } from '../../src/modules/company-members/entities/company-member.entity';
import type { ConversationGateway } from '../../src/modules/conversations/gateways/conversation.gateway';
import {
  NotificationDeliveredHandler,
  NotificationsReadHandler,
} from '../../src/modules/conversations/realtime/notification-realtime.handler';
import { Notification } from '../../src/modules/notifications/entities/notification.entity';
import { NotificationDeliveryService } from '../../src/modules/notifications/notification-delivery.service';
import type { NotificationDispatcher } from '../../src/modules/notifications/notification.dispatcher';
import type { NotifyInput } from '../../src/modules/notifications/notification.types';
import { NotificationUnreadCounter } from '../../src/modules/notifications/notification-unread.counter';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { MemoryRedis } from './memory-redis';

/**
 * The notification pipeline without BullMQ: `notify` delivers inline, and the
 * delivered/read events are relayed to the given (fake) gateway exactly like
 * the CQRS handlers do in the app.
 */
export function inlineNotifications(
  dataSource: DataSource,
  gateway: ConversationGateway | null,
  logger: PinoLogger,
) {
  const redis = new MemoryRedis();
  const published: unknown[] = [];
  const delivered = gateway ? new NotificationDeliveredHandler(gateway) : null;
  const read = gateway ? new NotificationsReadHandler(gateway) : null;

  const eventBus = {
    publish: (event: unknown) => {
      published.push(event);
      if (event instanceof NotificationDeliveredEvent) delivered?.handle(event);
      if (event instanceof NotificationsReadEvent) read?.handle(event);
    },
  } as unknown as EventBus;

  const notifications = dataSource.getRepository(Notification);
  const members = dataSource.getRepository(CompanyMember);
  const counter = new NotificationUnreadCounter(
    notifications,
    redis as unknown as AppRedis,
    logger,
  );
  const delivery = new NotificationDeliveryService(
    notifications,
    members,
    counter,
    redis as unknown as AppRedis,
    logger,
    eventBus,
  );
  const service = new NotificationsService(notifications, members, counter, eventBus);
  const dispatched: NotifyInput[] = [];
  const dispatcher = {
    notify: async (input: NotifyInput) => {
      dispatched.push(input);
      await delivery.deliver(input);
    },
  } as unknown as NotificationDispatcher;

  return { redis, eventBus, published, counter, delivery, service, dispatcher, dispatched };
}
