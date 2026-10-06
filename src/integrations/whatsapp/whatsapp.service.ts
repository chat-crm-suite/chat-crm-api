import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';

import {
  ChannelsService,
  ChannelTransmission,
} from '../../modules/channels/channels.service';
import { FailWhatsAppMessageCommand } from '../../modules/conversations/commands/fail-whatsapp-message.command';
import {
  classifyWhatsAppError,
  WhatsAppClient,
  type WhatsAppErrorInfo,
  type WhatsAppSendResponse,
} from './clients/whatsapp.client';
import { WhatsAppPayload } from './interfaces/whatsapp-message.interface';

/** T5: the send outcome without losing the error that caused the failure. */
export type WhatsAppDeliveryOutcome =
  | { ok: true; response: WhatsAppSendResponse }
  | { ok: false; error: WhatsAppErrorInfo };

/**
 * Provider facade for WhatsApp: resolves the company channel (decrypted
 * credentials) and delegates to the stateless HTTP client. Config CRUD lives
 * in `ChannelsService` / `/channels`.
 */
@Injectable()
export class WhatsAppService {
  constructor(
    private readonly channels: ChannelsService,
    private readonly client: WhatsAppClient,
    private readonly cls: ClsService,
    private readonly commandBus: CommandBus,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppService.name);
  }

  verifyToken(token: string) {
    return this.channels.verifyToken(token);
  }

  /** Webhook routing: active channel by phone_number_id, decrypted. */
  getTransmissionByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<ChannelTransmission | null> {
    return this.channels.getTransmissionByExternalAccountId(phoneNumberId);
  }

  async sendMessage(payload: WhatsAppPayload, companyId?: string) {
    const transmission = await this.resolveTransmission(companyId);
    if (!transmission) return;

    try {
      return await this.client.send(payload, transmission);
    } catch (error: unknown) {
      // The client already retried transport faults; anything that reaches
      // here is final (revoked token, server down after backoff...). Surface
      // it so the thread sees the failure instead of a silent log.
      await this.reportFailure(payload, error);
      return undefined;
    }
  }

  /**
   * T5: same send path, but the caller gets the outcome (response or the
   * classified error) instead of a silent `undefined`, so the outbound row can
   * persist the failure code/message.
   */
  async deliverMessage(
    payload: WhatsAppPayload,
    companyId?: string,
  ): Promise<WhatsAppDeliveryOutcome> {
    const transmission = await this.resolveTransmission(companyId);
    if (!transmission) {
      return {
        ok: false,
        error: {
          authFault: false,
          retryable: false,
          message: 'WhatsApp channel not configured',
        },
      };
    }

    try {
      const response = await this.client.send(payload, transmission);
      return { ok: true, response };
    } catch (error: unknown) {
      const info = classifyWhatsAppError(error);

      this.logger.error(
        { error, code: info.code, authFault: info.authFault },
        'WhatsApp send failed',
      );

      return { ok: false, error: info };
    }
  }

  private async resolveTransmission(
    companyId?: string,
  ): Promise<ChannelTransmission | null> {
    const resolvedCompanyId = companyId ?? this.cls.get<string>('company.id');

    if (!resolvedCompanyId) {
      this.logger.error('No company context to send a WhatsApp message');
      return null;
    }

    const transmission =
      await this.channels.getTransmissionForCompany(resolvedCompanyId);
    if (!transmission) {
      this.logger.error(
        { companyId: resolvedCompanyId },
        'No active WhatsApp channel for company',
      );
      return null;
    }

    return transmission;
  }

  private async reportFailure(
    payload: WhatsAppPayload,
    error: unknown,
  ): Promise<void> {
    const info = classifyWhatsAppError(error);

    this.logger.error(
      { error, code: info.code, authFault: info.authFault },
      'WhatsApp send failed',
    );

    const code = Number(info.code);

    await this.commandBus.execute(
      new FailWhatsAppMessageCommand(payload.to, {
        code: Number.isFinite(code) ? code : 0,
        title: 'Whatsapp cliente error',
        message: info.message,
        error_data: {
          details: `Request whatsapp client error for ${payload.type} message`,
        },
      }),
    );
  }
}
