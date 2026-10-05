import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import type {
  ChannelResponse,
  CreateChannelInput,
  UpdateChannelInput,
  WhatsAppCredentials,
} from '../../contracts/index';
import {
  decryptCredentials,
  encryptCredentials,
} from '../../lib/helpers/credentials.helper';
import { Channel } from './entities/channel.entity';

export interface ChannelTransmission {
  channel: Channel;
  credentials: WhatsAppCredentials;
}

/**
 * Channels: a company talks to customers through N channels. WhatsApp is the
 * first provider; credentials are stored as an AES-256-GCM envelope and never
 * returned by the API.
 */
@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    private readonly cls: ClsService,
  ) {}

  private get companyId(): string {
    return this.cls.get('company.id');
  }

  async list(): Promise<ChannelResponse[]> {
    const rows = await this.channels.find({
      where: { companyId: this.companyId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((channel) => this.sanitize(channel));
  }

  async getWhatsAppConfig(): Promise<ChannelResponse | null> {
    const channel = await this.findWhatsAppChannel();
    return channel ? this.sanitize(channel) : null;
  }

  async create(dto: CreateChannelInput): Promise<ChannelResponse> {
    const channel = this.channels.create({
      companyId: this.companyId,
      type: dto.type,
      name: dto.name ?? dto.displayAddress ?? 'WhatsApp',
      externalAccountId: dto.externalAccountId,
      displayAddress: dto.displayAddress,
      credentials: encryptCredentials({
        accessToken: dto.accessToken,
        businessId: dto.businessId,
      }),
      settings: {
        apiVersion: dto.apiVersion ?? 'v22.0',
        apiBaseUrl: dto.apiBaseUrl ?? 'https://graph.facebook.com',
        webhookUrl: dto.webhookUrl,
      },
      webhookVerifyToken:
        dto.webhookVerifyToken ?? randomBytes(32).toString('hex'),
      status: 'active',
    });

    return this.sanitize(await this.channels.save(channel));
  }

  async updateWhatsAppConfig(
    dto: UpdateChannelInput,
  ): Promise<ChannelResponse | null> {
    const channel = await this.findWhatsAppChannel();
    if (!channel) return null;

    const patch: Partial<Channel> = {};

    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.displayAddress !== undefined) patch.displayAddress = dto.displayAddress;
    if (dto.externalAccountId !== undefined) {
      patch.externalAccountId = dto.externalAccountId;
    }
    if (dto.webhookVerifyToken !== undefined) {
      patch.webhookVerifyToken = dto.webhookVerifyToken;
    }
    if (dto.status !== undefined) patch.status = dto.status;

    if (
      dto.apiVersion !== undefined ||
      dto.apiBaseUrl !== undefined ||
      dto.webhookUrl !== undefined
    ) {
      const current = (channel.settings ?? {}) as Record<string, unknown>;
      patch.settings = {
        ...current,
        ...(dto.apiVersion !== undefined ? { apiVersion: dto.apiVersion } : {}),
        ...(dto.apiBaseUrl !== undefined ? { apiBaseUrl: dto.apiBaseUrl } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
      };
    }

    if (dto.accessToken !== undefined || dto.businessId !== undefined) {
      const current = this.tryDecrypt(channel.credentials);
      patch.credentials = encryptCredentials({
        accessToken: dto.accessToken ?? current.accessToken,
        businessId: dto.businessId ?? current.businessId,
      });
    }

    return this.updateChannel(channel, patch);
  }

  private async updateChannel(
    channel: Channel,
    patch: Partial<Channel>,
  ): Promise<ChannelResponse> {
    const updated = this.channels.merge(channel, patch);
    await this.channels.save(updated);
    return this.sanitize(updated);
  }

  /** Webhook routing: an active channel owns the verify token. */
  async verifyToken(token: string): Promise<boolean> {
    return !!(await this.channels.findOne({
      where: { webhookVerifyToken: token },
      select: { id: true },
    }));
  }

  /** Webhook routing: active WhatsApp channel by phone_number_id. */
  async findActiveByExternalAccountId(
    externalAccountId: string,
  ): Promise<Channel | null> {
    return this.channels.findOne({
      where: { externalAccountId, type: 'whatsapp', status: 'active' },
    });
  }

  async getTransmissionByExternalAccountId(
    externalAccountId: string,
  ): Promise<ChannelTransmission | null> {
    const channel = await this.findActiveByExternalAccountId(externalAccountId);
    if (!channel) return null;

    return {
      channel,
      credentials: decryptCredentials<WhatsAppCredentials>(channel.credentials),
    };
  }

  /** Outbound path: the active WhatsApp channel of a company, decrypted. */
  async getTransmissionForCompany(
    companyId: string,
  ): Promise<ChannelTransmission | null> {
    const channel = await this.channels.findOne({
      where: { companyId, type: 'whatsapp', status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (!channel) return null;

    return {
      channel,
      credentials: decryptCredentials<WhatsAppCredentials>(channel.credentials),
    };
  }

  private findWhatsAppChannel(): Promise<Channel | null> {
    return this.channels.findOne({
      where: { companyId: this.companyId, type: 'whatsapp' },
      order: { createdAt: 'ASC' },
    });
  }

  private sanitize(channel: Channel): ChannelResponse {
    const settings = (channel.settings ?? {}) as Record<string, unknown>;

    let businessId: string | null = null;
    try {
      const credentials = decryptCredentials<WhatsAppCredentials>(
        channel.credentials,
      );
      businessId = credentials.businessId ?? null;
    } catch {
      businessId = null;
    }

    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      externalAccountId: channel.externalAccountId,
      displayAddress: channel.displayAddress ?? null,
      status: channel.status,
      webhookVerifyToken: channel.webhookVerifyToken ?? null,
      apiVersion: (settings.apiVersion as string) ?? null,
      apiBaseUrl: (settings.apiBaseUrl as string) ?? null,
      webhookUrl: (settings.webhookUrl as string) ?? null,
      businessId,
      hasCredentials: !!channel.credentials,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  private tryDecrypt(stored: string): WhatsAppCredentials {
    try {
      return decryptCredentials<WhatsAppCredentials>(stored);
    } catch {
      return { accessToken: '' };
    }
  }
}
