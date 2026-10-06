// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import { ConversationMessageDto } from '../dto/conversation-message.dto';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';

export class SaveConversationMessageCommand {
  constructor(
    public readonly data: SendConversationMessageDto | ConversationMessageDto,
  ) {}
}
