import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { CommandBus } from '@nestjs/cqrs';
import {
  Controller,
  HttpStatus,
  Body,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type WhatsappNotification,
  type WhatsappNotificationStatus,
} from '@daweto/whatsapp-api-types';

import { WebhookQuery } from '../dto/webhook.query.dto';
import { WhatsAppService } from '../whatsapp.service';
import { mapWebhookToMessages } from '../mappers/whatsapp-message.mapper';
import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { FailWhatsAppMessageCommand } from '../../../modules/conversations/commands/fail-whatsapp-message.command';
import {
  type DeliveryStatus,
  UpdateMessageStatusCommand,
} from '../../../modules/conversations/commands/update-message-status.command';
import { WhatsAppIntakeService } from '../intake/whatsapp-intake.service';
import { verifyWhatsAppSignature } from '../security/whatsapp-signature';
import {
  isDeliveryStatus,
  statusKind,
  toStatusDate,
  toStatusError,
} from '../status';

/** Wamids freshly persisted by this post, split by event family. */
interface FreshIntake {
  messages: Set<string>;
  /** `status:<state>:<wamid>` keys of freshly stored status ticks. */
  statuses: Set<string>;
}

export const enum WhatsappNotificationStatusStatus {
  Sent = 'sent',
  Delivered = 'delivered',
  Read = 'read',
  Failed = 'failed',
  Played = 'played',
}

@Controller('integration/webhook/whatsapp')
export class WebhookController {
  constructor(
    private readonly service: WhatsAppService,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
    private readonly intake: WhatsAppIntakeService,
  ) {
    this.logger.setContext(WebhookController.name);
  }

  @Get()
  async verifyWebhook(
    @Query()
    {
      ['hub.mode']: mode,
      ['hub.challenge']: challenge,
      ['hub.verify_token']: verify_token,
    }: WebhookQuery,
    @Res() res: Response,
  ) {
    const isValid = await this.service.verifyToken(verify_token);

    if (mode === 'subscribe' && isValid) {
      this.logger.debug('Webhook Verified');
      res.send(challenge);
    } else {
      res.sendStatus(HttpStatus.FORBIDDEN);
    }
  }

  @Post()
  async receiveMessage(
    @Body() payload: WhatsappNotification,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    this.logger.debug(payload, 'Webhook object');

    // T1: forged posts are rejected before anything is stored or queued.
    if (!this.hasValidSignature(req)) {
      res.sendStatus(HttpStatus.FORBIDDEN);
      return;
    }

    const change = payload?.entry?.[0]?.changes?.[0]?.value;
    if (!change) {
      res.sendStatus(HttpStatus.OK);
      return;
    }

    // Durable intake: every inbound `wamid` and every status tick is
    // persisted before the 200, so a crash from here on loses nothing (the
    // row is the recovery point). Retried events come back as duplicates and
    // create no work.
    const fresh = await this.persistInboundEvents(payload);
    res.sendStatus(HttpStatus.OK);

    this.dispatchNewMessages(payload, fresh.messages);
    this.dispatchStatuses(payload, fresh.statuses);
  }

  /**
   * Meta signs the raw bytes (`X-Hub-Signature-256`) with the single app
   * secret. Fail closed: no secret, no raw body, or a bad signature all
   * reject the post.
   */
  private hasValidSignature(req: RawBodyRequest<Request>): boolean {
    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET') ?? '';
    if (!appSecret) {
      this.logger.error(
        'WHATSAPP_APP_SECRET is not configured; rejecting webhook',
      );
      return false;
    }

    const header = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!req.rawBody) {
      this.logger.error('Webhook arrived without rawBody; rejecting');
      return false;
    }

    const valid = verifyWhatsAppSignature(req.rawBody, signature, appSecret);
    if (!valid) this.logger.warn('Invalid WhatsApp webhook signature');
    return valid;
  }

  /**
   * Persists one event per raw inbound message (every type, so T2 can replay
   * even the ones this stage still drops) plus one event per delivery-status
   * tick (so T4 can replay a crash-lost `delivered`/`read`/`failed`), and
   * returns the newly-seen keys.
   */
  private async persistInboundEvents(
    payload: WhatsappNotification,
  ): Promise<FreshIntake> {
    const fresh: FreshIntake = { messages: new Set(), statuses: new Set() };
    if (payload?.object !== 'whatsapp_business_account') return fresh;

    for (const entry of payload.entry ?? []) {
      for (const { field, value } of entry.changes ?? []) {
        if (field !== 'messages') continue;

        for (const message of value.messages ?? []) {
          if (!message?.id) continue;
          const outcome = await this.intake.persistIfNew({
            wamid: message.id,
            phoneNumberId: value.metadata?.phone_number_id,
            messageType: message.type,
            payload: message,
          });
          if (outcome === 'stored') fresh.messages.add(message.id);
        }

        for (const status of value.statuses ?? []) {
          if (!status?.id || !isDeliveryStatus(status.status)) continue;
          const kind = statusKind(status.status);
          const outcome = await this.intake.persistIfNew({
            wamid: status.id,
            kind,
            phoneNumberId: value.metadata?.phone_number_id,
            messageType: status.status,
            payload: status,
          });
          if (outcome === 'stored') {
            fresh.statuses.add(`${kind}:${status.id}`);
          }
        }
      }
    }

    return fresh;
  }

  private dispatchNewMessages(
    payload: WhatsappNotification,
    freshWamids: Set<string>,
  ): void {
    const { messages } = mapWebhookToMessages(payload);

    for (const msg of messages) {
      if (!freshWamids.has(msg.context.messageId)) continue;
      this.executeSafely(
        new ReceiveWhatsAppMessageCommand(msg),
        `ReceiveWhatsAppMessage(${msg.context.messageId})`,
      );
    }
  }

  private dispatchStatuses(
    payload: WhatsappNotification,
    freshStatuses: Set<string>,
  ): void {
    const { statuses } = mapWebhookToMessages(payload);

    for (const status of statuses) {
      switch (status.status as unknown as WhatsappNotificationStatusStatus) {
        case WhatsappNotificationStatusStatus.Sent:
          this.dispatchStatusUpdate(status, 'sent', freshStatuses);
          this.logger.debug(
            `Sent message with id ${status.id} | ${JSON.stringify(status.pricing)}`,
          );
          break;
        case WhatsappNotificationStatusStatus.Delivered:
          this.dispatchStatusUpdate(status, 'delivered', freshStatuses);
          this.logger.debug(`Delivered message with id (${status.id}) to user`);
          break;
        case WhatsappNotificationStatusStatus.Read:
          this.dispatchStatusUpdate(status, 'read', freshStatuses);
          this.logger.debug(`Read message with id (${status.id}) by user`);
          break;
        case WhatsappNotificationStatusStatus.Failed:
          if (!this.dispatchStatusUpdate(status, 'failed', freshStatuses)) {
            break;
          }
          // Existing transient flash for open chats; the persisted state above
          // is what keeps the failure visible without reloads.
          status.errors?.map((err) => {
            this.executeSafely(
              new FailWhatsAppMessageCommand(status.recipient_id, err),
              `FailWhatsAppMessage(${status.id})`,
            );

            void this.logger.error(
              err.error_data,
              `Webhook Error in message(${status.id}) [${err.message}] (${err.code}) | ${err.href}`,
            );
          });
          break;
      }
    }
  }

  /**
   * T4: applies one Meta state by `wamid` and pushes the live patch, only for
   * the tick this post persisted (a retried post is a noop). Runs after the
   * 200 (fire-and-forget), never blocking the webhook answer; the durable
   * event is consumed once applied, so a crash in between is replayed at boot.
   */
  private dispatchStatusUpdate(
    status: WhatsappNotificationStatus,
    state: DeliveryStatus,
    freshStatuses: Set<string>,
  ): boolean {
    const kind = statusKind(state);
    if (!freshStatuses.has(`${kind}:${status.id}`)) return false;

    const error = state === 'failed' ? toStatusError(status) : null;

    this.commandBus
      .execute(
        new UpdateMessageStatusCommand(
          status.id,
          state,
          toStatusDate(status.timestamp),
          error,
        ),
      )
      .then(() => this.intake.markReplayed(status.id, kind))
      .catch((error: unknown) => {
        this.logger.error(
          error,
          `Async webhook command failed: UpdateMessageStatus(${status.id})`,
        );
      });

    return true;
  }

  /**
   * El webhook ya respondió 200 a WhatsApp: un fallo procesando el mensaje
   * debe quedar en logs, nunca tumbar Node.
   */
  private executeSafely(command: object, description: string): void {
    this.commandBus.execute(command).catch((error: unknown) => {
      this.logger.error(error, `Async webhook command failed: ${description}`);
    });
  }
}
