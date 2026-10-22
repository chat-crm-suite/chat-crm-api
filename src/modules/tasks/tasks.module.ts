// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Task } from './entities/task.entity';
import { TASK_DUE_QUEUE, TaskDueProcessor, TaskDueScanner } from './task-due.scanner';
import { TasksController, WorkQueueController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WorkQueueCache } from './work-queue.cache';
import { WorkQueueInvalidationHandler } from './work-queue.events-handler';
import { WorkQueueService } from './work-queue.service';

/** Manual tasks + the derived work queue ("Mi trabajo"). */
@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Task]),
    ConversationsModule,
    NotificationsModule,
    BullModule.registerQueue({ name: TASK_DUE_QUEUE }),
  ],
  controllers: [TasksController, WorkQueueController],
  providers: [
    TasksService,
    WorkQueueService,
    WorkQueueCache,
    WorkQueueInvalidationHandler,
    TaskDueScanner,
    TaskDueProcessor,
  ],
  exports: [TasksService, WorkQueueCache],
})
export class TasksModule {}
