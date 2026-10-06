// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';

export class SendConversationMessageCommand extends Command<{
  conversationId: string;
}> {
  constructor(public readonly data: SendConversationMessageDto) {
    super();
  }
}
