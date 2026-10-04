import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';

import {
  ChannelsService,
  ChannelTransmission,
} from '../../modules/channels/channels.service';
import { WhatsAppClient } from './clients/whatsapp.client';
import { WhatsAppPayload } from './interfaces/whatsapp-message.interface';

/**
 * Provider facade for WhatsApp: resolves the company channel (decrypted
 * credentials) and delegates to the HTTP client. Config CRUD lives in
 * `ChannelsService` / `/channels`.
 */
@Injectable()
export class WhatsAppService {
  constructor(
    private readonly channels: ChannelsService,
    private readonly client: WhatsAppClient,
    private readonly cls: ClsService,
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

    this.client.setChannel(transmission.channel, transmission.credentials);

    return this.client.send(payload);
  }
}
