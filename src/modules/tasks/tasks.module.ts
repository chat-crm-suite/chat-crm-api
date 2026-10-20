// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversationsModule } from '../conversations/conversations.module';
import { Task } from './entities/task.entity';
import { TasksController, WorkQueueController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WorkQueueCache } from './work-queue.cache';
import { WorkQueueInvalidationHandler } from './work-queue.events-handler';
import { WorkQueueService } from './work-queue.service';

/** Manual tasks + the derived work queue ("Mi trabajo"). */
@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([Task]), ConversationsModule],
  controllers: [TasksController, WorkQueueController],
  providers: [TasksService, WorkQueueService, WorkQueueCache, WorkQueueInvalidationHandler],
  exports: [TasksService, WorkQueueCache],
})
export class TasksModule {}
