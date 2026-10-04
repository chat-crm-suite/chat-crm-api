import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { CommandBus } from '@nestjs/cqrs';
import {
  Controller, HttpStatus,
  Body, Get, Post, Query, Res
} from '@nestjs/common';
import {
  type WhatsappNotification,
} from '@daweto/whatsapp-api-types'

import { WebhookQuery } from '../dto/webhook.query.dto';
import { WhatsAppService } from '../whatsapp.service';
import { mapWebhookToMessages } from '../mappers/whatsapp-message.mapper';
import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { FailWhatsAppMessageCommand } from '../../../modules/chats/commands/fail-whatsapp-message.command';

export const enum WhatsappNotificationStatusStatus {
  Sent = "sent",
  Delivered = "delivered",
  Read = "read",
  Failed = 'failed',
  Played = 'played',
}

@Controller('integration/webhook/whatsapp')
export class WebhookController {
  constructor(
    private readonly service: WhatsAppService,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookController.name)
  }

  @Get()
  async verifyWebhook(
    @Query() {
      ['hub.mode']: mode,
      ['hub.challenge']: challenge,
      ['hub.verify_token']: verify_token
    }: WebhookQuery,
    @Res() res: Response,
  ) {
    const isValid = await this.service.verifyToken(verify_token);

    if (mode === 'subscribe' && isValid) {
      this.logger.debug('Webhook Verified')
      res.send(challenge);
    } else {
      res.sendStatus(HttpStatus.FORBIDDEN);
    }
  }

  @Post()
  receiveMessage(@Body() payload: WhatsappNotification, @Res() res: Response) {
    this.logger.debug(payload, 'Webhook object');

    // IMPORTANT: Always respond with 200 OK first,
    // otherwise WhatsApp will keep retrying the webhook endlessly.
    res.sendStatus(HttpStatus.OK)

    const change = payload?.entry?.[0]?.changes?.[0]?.value;
    if (!change) return;

    const { messages, statuses } = mapWebhookToMessages(payload);

    for (const status of statuses) {
      switch (status.status as unknown as WhatsappNotificationStatusStatus) {
        case WhatsappNotificationStatusStatus.Sent:
          this.logger.debug(`Sent message with id ${status.id} | ${JSON.stringify(status.pricing)}`);
          break;
        case WhatsappNotificationStatusStatus.Delivered:
          this.logger.debug(`Delivered message with id (${status.id}) to user`);
          break;
        case WhatsappNotificationStatusStatus.Failed:
          status.errors?.map((err) => {
            this.executeSafely(
              new FailWhatsAppMessageCommand(status.recipient_id, err),
              `FailWhatsAppMessage(${status.id})`,
            );

            void this.logger.error(
              err.error_data,
              `Webhook Error in message(${status.id}) [${err.message}] (${err.code}) | ${err.href}`
            )
          });
          break;
      }
    }

    for (const msg of messages) {
      this.executeSafely(
        new ReceiveWhatsAppMessageCommand(msg),
        `ReceiveWhatsAppMessage(${msg.context.messageId})`,
      );
    }
  }

  /**
   * El webhook ya respondió 200 a WhatsApp: un fallo procesando el mensaje
   * (ej. ER_DUP_ENTRY en contactos) debe quedar en logs, nunca tumbar Node.
   */
  private executeSafely(command: object, description: string): void {
    this.commandBus
      .execute(command)
      .catch((error: unknown) => {
        this.logger.error(error, `Async webhook command failed: ${description}`);
      });
  }
}

