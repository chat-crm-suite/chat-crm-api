// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { TasksModule } from '../../tasks/tasks.module';
import { TemplatesModule } from '../../templates/templates.module';
import { ConversationsModule } from '../conversations.module';
import { ConversationStartController } from './conversation-start.controller';
import { ConversationStartService } from './conversation-start.service';

/** `POST /conversations/start`: conversations + tasks + templates in one flow. */
@Module({
  imports: [CqrsModule, ConversationsModule, TasksModule, TemplatesModule],
  controllers: [ConversationStartController],
  providers: [ConversationStartService],
})
export class ConversationStartModule {}
