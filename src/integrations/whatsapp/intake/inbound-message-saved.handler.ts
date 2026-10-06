import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { WhatsAppIntakeService } from './whatsapp-intake.service';

/**
 * Consumes the durable intake event (T1 hook) as soon as a saved message
 * carries its `wamid`: after this the event is no longer replay material.
 * Runs for every saved message; non-inbound rows have no `externalId` or an
 * unknown one, which `markReplayed` treats as a noop.
 */
@EventsHandler(MessageSavedEvent)
export class InboundMessageSavedHandler
  implements IEventHandler<MessageSavedEvent>
{
  constructor(
    private readonly intake: WhatsAppIntakeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMessageSavedHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    const wamid = message?.externalId;
    if (!wamid) return;

    try {
      await this.intake.markReplayed(wamid);
    } catch (error: unknown) {
      // The event stays pending: the boot replay is the backstop.
      this.logger.error(
        { error, wamid },
        'Failed to consume inbound event after save',
      );
    }
  }
}
