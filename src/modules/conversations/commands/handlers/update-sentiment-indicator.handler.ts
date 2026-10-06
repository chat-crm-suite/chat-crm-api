// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ConversationSocketEvent } from '../../../../contracts/index';
import { ConversationGateway } from '../../gateways/conversation.gateway';
import { UpdateSentimentIndicatorCommand as Command } from '../update-sentiment-indicator.command';

@CommandHandler(Command)
export class UpdateSentimentIndicatorHandler
  implements ICommandHandler<Command>
{
  constructor(
    private readonly logger: PinoLogger,
    private readonly gateway: ConversationGateway,
  ) {
    this.logger.setContext(UpdateSentimentIndicatorHandler.name);
  }

  execute(command: Command): Promise<{ conversationId?: string }> {
    if (command.conversationId) {
      this.gateway.server
        .to(`conversation:${command.conversationId}`)
        .emit(ConversationSocketEvent.UpdateSentimentIndicator, command.probabilities);
    }

    this.logger.debug(command.probabilities, 'Update sentiment');

    return Promise.resolve({ conversationId: command.conversationId });
  }
}
