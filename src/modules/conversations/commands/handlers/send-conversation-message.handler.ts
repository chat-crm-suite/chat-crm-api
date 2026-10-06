// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { SendConversationMessageDto } from '../../dto/send-conversation-message.dto';
import { SendConversationMessageCommand } from '../send-conversation-message.command';

@CommandHandler(SendConversationMessageCommand)
export class SendConversationMessageHandler
  implements ICommandHandler<SendConversationMessageCommand>
{
  constructor(
    @InjectQueue('chat') private readonly queue: Queue<SendConversationMessageDto>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SendConversationMessageHandler.name);
  }

  execute(command: SendConversationMessageCommand): Promise<{ conversationId: string }> {
    this.logger.debug('Execute Queue: chat');
    void this.queue.add('send-message', command.data);

    return Promise.resolve({ conversationId: command.data.room });
  }
}
