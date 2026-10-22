// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChannelsModule } from '../channels/channels.module';
import { Channel } from '../channels/entities/channel.entity';
import { MessageTemplate } from '../channels/entities/message-template.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { MediaModule } from '../media/media.module';
import { ConversationTemplateController } from './conversation-template.controller';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Provider templates: list, groups, sync, settings and send (channel-agnostic). */
@Module({
  imports: [
    TypeOrmModule.forFeature([MessageTemplate, Channel]),
    ChannelsModule,
    ConversationsModule,
    MediaModule,
  ],
  controllers: [TemplatesController, ConversationTemplateController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
