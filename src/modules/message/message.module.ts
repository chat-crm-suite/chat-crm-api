// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Conversation } from '../conversations/entities/conversation.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessageStatusEvent } from './entities/message-status-event.entity';
import { Message } from './entities/message.entity';
import { MessageRepository } from './message.repository';
import { MessageService } from './message.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      MessageAttachment,
      MessageStatusEvent,
      Conversation,
    ]),
  ],
  providers: [MessageService, MessageRepository],
  exports: [MessageService, MessageRepository],
})
export class MessageModule {}
