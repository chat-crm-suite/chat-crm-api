import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ConversationFanoutService } from '../../realtime/conversation-fanout.service';
import { BroadcastConversationMessageCommand } from '../broadcast-conversation-message.command';

/**
 * T6: the broadcast command is the live-message entry point; it hands the body
 * to the single fanout path (conversation room + assignee preview).
 */
@CommandHandler(BroadcastConversationMessageCommand)
export class BroadcastConversationMessageHandler
  implements ICommandHandler<BroadcastConversationMessageCommand>
{
  constructor(
    private readonly fanout: ConversationFanoutService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BroadcastConversationMessageCommand.name);
  }

  async execute(
    command: BroadcastConversationMessageCommand,
  ): Promise<{ id: string }> {
    if (!command.conversationId) {
      this.logger.error('ConversationId NO defined in message');
      return { id: command.id };
    }

    await this.fanout.emitMessage(command.conversationId, command.payload);
    this.logger.debug(command, 'Broadcast message');

    return { id: command.id };
  }
}
