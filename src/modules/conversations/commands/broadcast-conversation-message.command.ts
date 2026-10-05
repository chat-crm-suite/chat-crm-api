import { Command } from '@nestjs/cqrs';

import type { ConversationMessagePayload } from '../../message/message.types';

export class BroadcastConversationMessageCommand extends Command<{
  id: string;
}> {
  constructor(
    public readonly id: string,
    public readonly payload: ConversationMessagePayload,
    public readonly conversationId?: string,
  ) {
    super();
  }
}
