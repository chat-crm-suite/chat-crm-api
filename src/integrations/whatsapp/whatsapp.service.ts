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
} from './clients/whatsapp.client';
import { WhatsAppPayload } from './interfaces/whatsapp-message.interface';

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
    const resolvedCompanyId =
      companyId ?? this.cls.get<string>('company.id');

    if (!resolvedCompanyId) {
      this.logger.error('No company context to send a WhatsApp message');
      return;
    }

    const transmission =
      await this.channels.getTransmissionForCompany(resolvedCompanyId);
    if (!transmission) {
      this.logger.error(
        { companyId: resolvedCompanyId },
        'No active WhatsApp channel for company',
      );
      return;
    }

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
