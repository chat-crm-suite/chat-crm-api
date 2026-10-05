import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { ReceiveWhatsAppMessageCommand } from '../receive-whatsapp-message.command';
import { WhatsAppService } from '../../whatsapp.service';
import { MessageContentHandlers } from './message-content.handlers';

@CommandHandler(ReceiveWhatsAppMessageCommand)
export class ReceiveWhatsAppMessageHandler
  implements ICommandHandler<ReceiveWhatsAppMessageCommand>
{
  constructor(
    private readonly contentHandlers: MessageContentHandlers,
    private readonly service: WhatsAppService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReceiveWhatsAppMessageCommand.name);
  }

  async execute({ message }: ReceiveWhatsAppMessageCommand) {
    const { context, content } = message;

    const transmission = await this.service.getTransmissionByPhoneNumberId(
      context.phoneNumberId,
    );

    if (!transmission) {
      this.logger.debug(
        { phoneNumberId: context.phoneNumberId },
        'No active channel found for webhook',
      );
      return;
    }

    this.logger.debug(
      { channelId: transmission.channel.id },
      'Load WhatsApp channel',
    );
    await this.contentHandlers
      .getHandler(content.type)
      ?.handle(content, context, transmission);
  }
}
