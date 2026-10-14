// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversationsModule } from '../conversations/conversations.module';
import { Conversation } from '../conversations/entities/conversation.entity';
import { CasesController } from './cases.controller';
import { CaseMessageSavedHandler } from './cases.events-handler';
import { CasesService } from './cases.service';
import { CaseReply } from './entities/case-reply.entity';
import { Case } from './entities/case.entity';

/** Support-case lifecycle (open on inbound, answer, close, reopen). */
@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Case, CaseReply, Conversation]),
    ConversationsModule,
  ],
  controllers: [CasesController],
  providers: [CasesService, CaseMessageSavedHandler],
  exports: [CasesService],
})
export class CasesModule {}
