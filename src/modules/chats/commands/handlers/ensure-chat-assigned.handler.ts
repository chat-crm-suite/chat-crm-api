import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { ChatsService } from '../../chats.service';
import { AssignmentOutcome } from '../../assignment/assignment.types';
import { EnsureChatAssignedCommand } from '../ensure-chat-assigned.command';

@CommandHandler(EnsureChatAssignedCommand)
export class EnsureChatAssignedHandler
  implements ICommandHandler<EnsureChatAssignedCommand>
{
  constructor(
    private readonly chats: ChatsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EnsureChatAssignedHandler.name);
  }

  async execute(command: EnsureChatAssignedCommand): Promise<AssignmentOutcome> {
    try {
      return await this.chats.ensureAssigned(command.chatId, command.companyId);
    } catch (error) {
      // El flujo de mensajes nunca se rompe por una asignación fallida.
      this.logger.error(
        { chatId: command.chatId, error: String(error) },
        'Auto-assign failed',
      );
      return AssignmentOutcome.SKIPPED;
    }
  }
}
