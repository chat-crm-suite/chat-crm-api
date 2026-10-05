import { Command } from '@nestjs/cqrs';

import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';

export class SendConversationMessageCommand extends Command<{
  conversationId: string;
}> {
  constructor(public readonly data: SendConversationMessageDto) {
    super();
  }
}
