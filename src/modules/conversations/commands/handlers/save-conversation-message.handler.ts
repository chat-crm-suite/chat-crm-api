// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { ConversationMessageDto } from '../../dto/conversation-message.dto';
import { SendConversationMessageDto } from '../../dto/send-conversation-message.dto';
import { SaveConversationMessageCommand } from '../save-conversation-message.command';

@CommandHandler(SaveConversationMessageCommand)
export class SaveConversationMessageHandler
  implements ICommandHandler<SaveConversationMessageCommand>
{
  constructor(
    @InjectQueue('chat')
    private readonly queue: Queue<SendConversationMessageDto | ConversationMessageDto>,
  ) {}

  execute({ data }: SaveConversationMessageCommand): Promise<unknown> {
    return this.queue.add('save-message', data);
  }
}
