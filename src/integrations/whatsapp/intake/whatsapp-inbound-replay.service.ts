// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MessageService } from '../../../modules/message/message.service';
import { UpdateMessageStatusCommand } from '../../../modules/conversations/commands/update-message-status.command';
import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import type { WhatsappInboundEvent } from '../entities/whatsapp-inbound-event.entity';
import { toParsedMessage } from '../mappers/whatsapp-message.mapper';
import { isDeliveryStatus, toStatusDate, toStatusError } from '../status';
import { WhatsAppIntakeService } from './whatsapp-intake.service';

const DEFAULT_REPLAY_LIMIT = 50;
const STATUS_KIND_PREFIX = 'status:';

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
    let replayed = 0;

    // A crash backlog can be larger than one page: keep draining until the
    // store is empty. A full page that consumed nothing is returned again by
    // the next query (failed events stay pending), so stop there.
    for (;;) {
      const pending = await this.intake.listPending(limit);
      if (!pending.length) break;

      let consumed = 0;

      for (const event of pending) {
        try {
          const kind = event.kind ?? 'message';

          // T4: a status tick persisted before the crash goes through the
          // same update command the live webhook uses.
          if (kind.startsWith(STATUS_KIND_PREFIX)) {
            await this.replayStatus(event, kind);
            await this.intake.markReplayed(event.wamid, kind);
            consumed++;
            replayed++;
            continue;
          }

          const message = toParsedMessage(event.payload, event.phoneNumberId);

          if (!message) {
            this.logger.warn(
              { wamid: event.wamid, messageType: event.messageType },
              'Inbound event cannot be replayed (unknown type or malformed payload); consuming it',
            );
            await this.intake.markReplayed(event.wamid, kind);
            consumed++;
            continue;
          }

          const existing = await this.messages.findByExternalId(event.wamid);
          if (existing) {
            await this.intake.markReplayed(event.wamid, kind);
            consumed++;
            continue;
          }

          await this.commandBus.execute(
            new ReceiveWhatsAppMessageCommand(message),
          );
          await this.intake.markReplayed(event.wamid, kind);
          consumed++;
          replayed++;
        } catch (error: unknown) {
          this.logger.error(
            { error, wamid: event.wamid },
            'Inbound event replay failed; leaving it pending',
          );
        }
      }

      if (pending.length < limit || consumed === 0) break;
    }

    if (replayed > 0) {
      this.logger.debug({ replayed }, 'Replayed pending inbound events');
    }

    return replayed;
  }

  /** T4: applies one persisted status tick through the live command path. */
  private async replayStatus(
    event: WhatsappInboundEvent,
    kind: string,
  ): Promise<void> {
    const state = kind.slice(STATUS_KIND_PREFIX.length);

    if (!isDeliveryStatus(state)) {
      this.logger.warn(
        { wamid: event.wamid, kind },
        'Unknown status event kind; consuming it',
      );
      return;
    }

    const payload = event.payload as { timestamp?: unknown } | null;

    await this.commandBus.execute(
      new UpdateMessageStatusCommand(
        event.wamid,
        state,
        toStatusDate(payload?.timestamp),
        toStatusError(event.payload),
      ),
    );
  }
}
