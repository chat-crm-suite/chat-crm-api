// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationInboundReopenHandler } from '../conversations/lifecycle/conversation-inbound-reopen.handler';
import { ConversationLifecycleController } from '../conversations/lifecycle/conversation-lifecycle.controller';
import { ConversationLifecycleService } from '../conversations/lifecycle/conversation-lifecycle.service';
import { Conversation } from '../conversations/entities/conversation.entity';
import { CasesController } from './cases.controller';
import { CaseMessageSavedHandler } from './cases.events-handler';
import { CasesService } from './cases.service';
import { CaseReply } from './entities/case-reply.entity';
import { Case } from './entities/case.entity';

/**
 * Support-case lifecycle (open on inbound, answer, close, reopen) and the
 * conversation lifecycle built on it (resolve, pending, reopen, release,
 * transfer).
 */
@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Case, CaseReply, Conversation]),
    ConversationsModule,
  ],
  controllers: [CasesController, ConversationLifecycleController],
  providers: [
    CasesService,
    CaseMessageSavedHandler,
    // Lifecycle lives with cases: resolving closes the case, reopening opens one.
    ConversationLifecycleService,
    ConversationInboundReopenHandler,
  ],
  exports: [CasesService, ConversationLifecycleService],
})
export class CasesModule {}
