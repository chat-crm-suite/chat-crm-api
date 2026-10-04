import { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { MessageContext } from '../../types/whatsapp.types';

export interface ContentHandlerPort<T> {
  handle(
    content: T,
    context: MessageContext,
    transmission: ChannelTransmission,
  ): Promise<void> | void;
}
