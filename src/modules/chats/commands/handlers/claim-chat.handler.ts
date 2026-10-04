import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { ChatsService } from '../../chats.service';
import { AssignmentOutcome } from '../../assignment/assignment.types';
import { ClaimChatCommand } from '../claim-chat.command';

@CommandHandler(ClaimChatCommand)
export class ClaimChatHandler implements ICommandHandler<ClaimChatCommand> {
  constructor(
    private readonly chats: ChatsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ClaimChatHandler.name);
  }

  async execute(command: ClaimChatCommand): Promise<AssignmentOutcome> {
    try {
      return await this.chats.claim(
        command.chatId,
        command.agentId,
        command.companyId,
      );
    } catch (error) {
      this.logger.error(
        { chatId: command.chatId, agentId: command.agentId, error: String(error) },
        'Claim failed',
      );
      return AssignmentOutcome.SKIPPED;
    }
  }
}
