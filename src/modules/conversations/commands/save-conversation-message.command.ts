import { Command } from '@nestjs/cqrs';

import { ConversationMessageDto } from '../dto/conversation-message.dto';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';

export class SaveConversationMessageCommand {
  constructor(
    public readonly data: SendConversationMessageDto | ConversationMessageDto,
  ) {}
}
