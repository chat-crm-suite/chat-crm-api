import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ConversationsService } from '../../conversations.service';
import { AssignmentOutcome } from '../../assignment/assignment.types';
import { EnsureConversationAssignedCommand } from '../ensure-conversation-assigned.command';

@CommandHandler(EnsureConversationAssignedCommand)
export class EnsureConversationAssignedHandler
  implements ICommandHandler<EnsureConversationAssignedCommand>
{
  constructor(
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EnsureConversationAssignedHandler.name);
  }

  async execute(
    command: EnsureConversationAssignedCommand,
  ): Promise<AssignmentOutcome> {
    try {
      return await this.conversations.ensureAssigned(
        command.conversationId,
        command.companyId,
      );
    } catch (error) {
      // El flujo de mensajes nunca se rompe por una asignación fallida.
      this.logger.error(
        { conversationId: command.conversationId, error: String(error) },
        'Auto-assign failed',
      );
      return AssignmentOutcome.SKIPPED;
    }
  }
}
