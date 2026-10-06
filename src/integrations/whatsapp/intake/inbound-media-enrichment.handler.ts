import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MessageSavedEvent } from '../../../modules/conversations/events/message-saved.event';
import { InboundMediaEnrichmentService } from './inbound-media-enrichment.service';

/**
 * T3 trigger: as soon as a message row is saved, any pending media reference
 * is enriched in the background. A failure here must never bubble into the
 * event bus (the row and its failed attachment are already durable).
 */
@EventsHandler(MessageSavedEvent)
export class InboundMediaEnrichmentHandler
  implements IEventHandler<MessageSavedEvent>
{
  constructor(
    private readonly enrichment: InboundMediaEnrichmentService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InboundMediaEnrichmentHandler.name);
  }

  async handle({ message }: MessageSavedEvent): Promise<void> {
    try {
      await this.enrichment.enrich(message);
    } catch (error: unknown) {
      this.logger.error(
        { error, messageId: message?.id },
        'Inbound media enrichment pass failed',
      );
    }
  }
}
