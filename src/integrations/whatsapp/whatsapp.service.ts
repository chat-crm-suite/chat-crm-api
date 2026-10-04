import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import { WhatsAppConfig } from '../../entities/index';
import { InjectRepository } from '@nestjs/typeorm';
import { WhatsAppClient } from './clients/whatsapp.client';
import { WhatsAppPayload } from './interfaces/whatsapp-message.interface';
import {
  CreateWhatsAppConfigInput,
  UpdateWhatsAppConfigInput,
} from '../../contracts/index';

@Injectable()
export class WhatsAppService {
  constructor(
    @InjectRepository(WhatsAppConfig)
    private readonly configRepository: Repository<WhatsAppConfig>,
    private readonly client: WhatsAppClient,
    private readonly cls: ClsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppService.name);
  }

  async verifyToken(token: string) {
    return !!(await this.configRepository.findOne({
      where: { webhookVerifyToken: token },
      cache: true,
    }));
  }

  async getConfig() {
    this.logger.debug(
      `User ${this.cls.get('user.id')} get config with ${this.cls.get('company.id')}`,
    );
    return this.configRepository.findOne({
      where: {
        company: { id: this.cls.get('company.id') },
      },
      cache: true,
    });
  }

  async sendMessage(payload: WhatsAppPayload) {
    const config = await this.getConfig();

    if (!config) {
      this.logger.error('Config no found in service');
      return;
    }

    this.logger.debug(config, 'Config in service');
    this.client.setConfig(config);

    return this.client.send(payload);
  }

  async getConfigByPhoneNumberId(phoneNumberId: string) {
    return this.configRepository.findOne({
      where: {
        phoneNumberId,
        isActive: true,
      },
      // La empresa es necesaria para asignar el chat al agente correcto (Q4).
      relations: ['company'],
      cache: true,
    });
  }

  createConfig(config: CreateWhatsAppConfigInput) {
    const company = { id: this.cls.get('company.id') };
    const waConfig = this.configRepository.create({
      ...config,
      company,
    });

    return this.configRepository.save(waConfig);
  }

  /**
   * Returns the fresh configuration so the response always matches the
   * `WhatsAppConfigSchema` contract (the raw `UpdateResult` is not a config).
   */
  async updateConfig(config: UpdateWhatsAppConfigInput) {
    await this.configRepository.update(
      {
        company: { id: this.cls.get('company.id') },
      },
      config,
    );

    return this.getConfig();
  }

  // async sendTemplateMessage(to: string, templateName: string, languageCode: string, companyId?: string) {
  //   const { apiBaseUrl, apiVersion, phoneNumberId, accessToken } = await this.configService.getActiveByCompany(companyId ?? '');
  //   const url = `${apiBaseUrl}/${apiVersion}/${phoneNumberId}/messages`;
  //   // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  //   const payload: any = this.factory.template(to, templateName, languageCode);

  //   return this.client.sendMessage(url, accessToken, payload).catch(err => {
  //     this.logger.debug(`Info request WhatsApp API: ${apiBaseUrl} - ${apiVersion} - ${phoneNumberId}`);
  //     this.logger.debug(`Payload request WhatsApp API: ${JSON.stringify(payload, null, 2)}`);
  //     this.logger.debug(`Error sending template message to ${to}`);
  //     throw err;
  //   });
  // }

  // async sendTextMessage(to: string, message: string, companyId?: string) {
  //   const { apiBaseUrl, apiVersion, phoneNumberId, accessToken } = await this.configService.getActiveByCompany(companyId);
  //   const url = `${apiBaseUrl}/${apiVersion}/${phoneNumberId}/messages`;
  //   const payload = this.factory.text(to, message);

  //   return this.client.sendMessage(url, accessToken, payload).catch(err => {
  //     this.logger.debug(`Info request WhatsApp API: ${apiBaseUrl} - ${apiVersion} - ${phoneNumberId}`);
  //     this.logger.debug(`Payload request WhatsApp API: ${JSON.stringify(payload, null, 2)}`);
  //     this.logger.debug(`Error sending message to ${to}`);
  //     throw err;
  //   });
  // }

  // async sendMessage(to: string, message: string) {
  //   const { apiBaseUrl, phoneNumberId, accessToken } = await this.configService.active();
  //   const url = `${apiBaseUrl}/${phoneNumberId}/messages`;
  //   const payload = this.factory.text(to, message);

  //   return this.client.sendMessage(url, accessToken, payload);
  // }
}
