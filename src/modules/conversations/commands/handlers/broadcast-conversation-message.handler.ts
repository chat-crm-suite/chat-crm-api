import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ConversationSocketEvent } from '../../../../contracts/index';
import { ConversationGateway } from '../../gateways/conversation.gateway';
import { BroadcastConversationMessageCommand } from '../broadcast-conversation-message.command';

@CommandHandler(BroadcastConversationMessageCommand)
export class BroadcastConversationMessageHandler
  implements ICommandHandler<BroadcastConversationMessageCommand>
{
  constructor(
    private readonly gateway: ConversationGateway,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BroadcastConversationMessageCommand.name);
  }

  async execute(
    command: BroadcastConversationMessageCommand,
  ): Promise<{ id: string }> {
    if (command.conversationId) {
      const room = `conversation:${command.conversationId}`;
      this.logger.debug(
        `This is room occupied: ${await this.gateway.hasSockets(room)}`,
      );

      this.gateway.server
        .to(room)
        .emit(ConversationSocketEvent.BroadcastMessage, command.payload);
      this.logger.debug(command, 'Broadcast message');
    } else {
      this.logger.error('ConversationId NO defined in message');
    }

    return Promise.resolve({ id: command.id });
  }
}
