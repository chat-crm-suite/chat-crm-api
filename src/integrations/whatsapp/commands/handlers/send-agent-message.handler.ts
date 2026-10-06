import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { Message } from '../../../../modules/message/entities/message.entity';
import { AgentMessageSender } from '../../outbound/agent-message-sender.service';
import { SendAgentMessageCommand } from '../send-agent-message.command';

@CommandHandler(SendAgentMessageCommand)
export class SendAgentMessageHandler implements ICommandHandler<SendAgentMessageCommand> {
  constructor(
    private readonly sender: AgentMessageSender,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SendAgentMessageHandler.name);
  }

  execute(command: SendAgentMessageCommand): Promise<Message | null> {
    this.logger.debug(
      { conversationId: command.data.room },
      'Send agent message',
    );

    return this.sender.send(command.data);
  }
}
