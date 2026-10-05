import { ConversationMessageDto } from '../dto/conversation-message.dto';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';

export class ConversationMessageSentEvent {
  constructor(
    public readonly payload: SendConversationMessageDto | ConversationMessageDto,
  ) {}
}
