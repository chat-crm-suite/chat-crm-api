import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MessageService } from '../../../modules/message/message.service';
import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { toParsedMessage } from '../mappers/whatsapp-message.mapper';
import { WhatsAppIntakeService } from './whatsapp-intake.service';

const DEFAULT_REPLAY_LIMIT = 50;

/**
 * T2 consumer of the T1 inbound-events store. On boot it replays every event
 * that never reached a conversation row (crash between the 200 and the save),
 * rehydrating it from its stored payload instead of a webhook. An event whose
 * row already exists is consumed without dispatching, so replays are
 * idempotent.
 */
@Injectable()
export class WhatsAppInboundReplayService implements OnApplicationBootstrap {
  constructor(
    private readonly intake: WhatsAppIntakeService,
    private readonly messages: MessageService,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppInboundReplayService.name);
  }

  onApplicationBootstrap(): void {
    void this.replayPending().catch((error) =>
      this.logger.error(error, 'Inbound replay pass failed'),
    );
  }

  /** Returns how many events were dispatched into the message pipeline. */
  async replayPending(limit = DEFAULT_REPLAY_LIMIT): Promise<number> {
    const pending = await this.intake.listPending(limit);
    let replayed = 0;

    for (const event of pending) {
      try {
        const message = toParsedMessage(event.payload, event.phoneNumberId);

        if (!message) {
          this.logger.warn(
            { wamid: event.wamid, messageType: event.messageType },
            'Inbound event cannot be replayed (unknown type or malformed payload); consuming it',
          );
          await this.intake.markReplayed(event.wamid);
          continue;
        }

        const existing = await this.messages.findByExternalId(event.wamid);
        if (existing) {
          await this.intake.markReplayed(event.wamid);
          continue;
        }

        await this.commandBus.execute(
          new ReceiveWhatsAppMessageCommand(message),
        );
        await this.intake.markReplayed(event.wamid);
        replayed++;
      } catch (error: unknown) {
        this.logger.error(
          { error, wamid: event.wamid },
          'Inbound event replay failed; leaving it pending',
        );
      }
    }

    if (replayed > 0) {
      this.logger.debug({ replayed }, 'Replayed pending inbound events');
    }

    return replayed;
  }
}
