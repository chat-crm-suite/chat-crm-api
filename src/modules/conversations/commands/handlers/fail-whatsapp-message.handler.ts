import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { ConversationSocketEvent } from '../../../../contracts/index';
import { ConversationRepository } from '../../conversation.repository';
import { ConversationGateway } from '../../gateways/conversation.gateway';
import { FailWhatsAppMessageCommand } from '../fail-whatsapp-message.command';

@CommandHandler(FailWhatsAppMessageCommand)
export class FailWhatsAppMessageHandler
  implements ICommandHandler<FailWhatsAppMessageCommand>
{
  constructor(
    private readonly gateway: ConversationGateway,
    private readonly repository: ConversationRepository,
  ) {}

  async execute(command: FailWhatsAppMessageCommand): Promise<unknown> {
    const conversation = await this.repository.findConversationByCustomerPhone(
      command.recipientId,
    );
    if (!conversation) return;

    const room = `conversation:${conversation.id}`;
    if (await this.gateway.hasSockets(room)) {
      return this.gateway.server
        .to(room)
        .emit(ConversationSocketEvent.ErrorMessage, command.err);
    }

    return undefined;
  }
}
