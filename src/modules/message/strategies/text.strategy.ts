import { WhatsAppTextBuilder } from '../../../integrations/whatsapp/builders/whatsapp-text.builder';
import type {
  WhatsAppPayload,
  WhatsAppTextContent,
} from '../../../integrations/whatsapp/interfaces/whatsapp-message.interface';
import type { Message } from '../entities/message.entity';
import { getConversationMessageBase } from '../mappers/conversation-message.mapper';
import type { ConversationMessagePayload } from '../message.types';
import type { MessageStrategy } from './message.strategy';

export class TextMessageStrategy implements MessageStrategy {
  toWhatsAppPayload(to: string, content: WhatsAppTextContent): WhatsAppPayload {
    return new WhatsAppTextBuilder()
      .to(to)
      .body(content.body)
      .previewUrl(content.preview_url)
      .build();
  }

  toBroadcastFields(message: Message): ConversationMessagePayload {
    return {
      ...getConversationMessageBase(message),
      msg: {
        type: 'text',
        mediaUrl: null,
        content: { body: message.body ?? undefined },
      },
    };
  }
}
