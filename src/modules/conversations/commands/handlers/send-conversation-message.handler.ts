// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import {
  type AgentSendJob,
  SendConversationMessageCommand,
} from '../send-conversation-message.command';

@CommandHandler(SendConversationMessageCommand)
export class SendConversationMessageHandler
  implements ICommandHandler<SendConversationMessageCommand>
{
  constructor(
    @InjectQueue('chat') private readonly queue: Queue<AgentSendJob>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SendConversationMessageHandler.name);
  }

  /** Resolves once the job is stored in Redis: the send can no longer be lost. */
  async execute(
    command: SendConversationMessageCommand,
  ): Promise<{ conversationId: string }> {
    this.logger.debug('Execute Queue: chat');
    await this.queue.add('send-message', command.data);

    return { conversationId: command.data.room };
  }
}
