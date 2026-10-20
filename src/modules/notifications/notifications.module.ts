// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompanyMember } from '../company-members/entities/company-member.entity';
import { Notification } from './entities/notification.entity';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDispatcher } from './notification.dispatcher';
import { NOTIFICATIONS_QUEUE } from './notification.types';
import { NotificationUnreadCounter } from './notification-unread.counter';
import { NotificationController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  ChannelDownNoticeHandler,
  IaDownNoticeHandler,
} from './producers/system-notices.handlers';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Notification, CompanyMember]),
    BullModule.registerQueue({
      name: NOTIFICATIONS_QUEUE,
      // Rows live in MySQL; jobs stay in Redis only long enough for the
      // job-id dedupe to absorb a burst of the same event, and for a look.
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 60 * 60, count: 5_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationsService,
    NotificationDispatcher,
    NotificationDeliveryService,
    NotificationUnreadCounter,
    NotificationsProcessor,
    ChannelDownNoticeHandler,
    IaDownNoticeHandler,
  ],
  exports: [NotificationsService, NotificationDispatcher],
})
export class NotificationsModule {}
