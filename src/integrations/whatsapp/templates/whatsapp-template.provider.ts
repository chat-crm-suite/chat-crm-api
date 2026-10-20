// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ChannelsService } from '@modules/channels/channels.service';
import type {
  ChannelOutcome,
  ResolvedTemplate,
} from '@modules/channels/ports/channel-adapter.port';
import type {
  RemoteTemplate,
  SendableTemplate,
  TemplateProvider,
} from '@modules/channels/ports/channel-template.port';
import { ChannelTemplateRegistry } from '@modules/channels/ports/channel-template.registry';
import { classifyWhatsAppError, WhatsAppClient } from '../clients/whatsapp.client';
import {
  buildWhatsAppTemplateSend,
  normalizeWhatsAppTemplate,
} from './whatsapp-template.mapper';

/**
 * WhatsApp message templates (HSM) behind the template port: lists the WABA
 * templates through the stateless Graph client and normalizes them. Faults
 * come back as a classified `ChannelFailure`, never thrown.
 */
@Injectable()
export class WhatsAppTemplateProvider implements TemplateProvider, OnModuleInit {
  readonly type = 'whatsapp' as const;

  constructor(
    private readonly channels: ChannelsService,
    private readonly client: WhatsAppClient,
    private readonly registry: ChannelTemplateRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppTemplateProvider.name);
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listRemote(
    channelId: string,
  ): Promise<ChannelOutcome<{ templates: RemoteTemplate[] }>> {
    const transmission = await this.channels.getTransmissionByChannelId(channelId);
    if (!transmission) {
      return failure('WhatsApp channel not configured');
    }
    if (!transmission.credentials.businessId) {
      return failure('The WhatsApp channel has no Business Account ID');
    }

    try {
      const templates = await this.client.listTemplates(transmission);
      return { ok: true, templates: templates.map(normalizeWhatsAppTemplate) };
    } catch (error: unknown) {
      const info = classifyWhatsAppError(error);
      this.logger.error(
        { channelId, code: info.code, authFault: info.authFault },
        'WhatsApp template listing failed',
      );
      return { ok: false, error: info };
    }
  }

  buildSend(
    template: SendableTemplate,
    params: Readonly<Record<string, string>>,
  ): ResolvedTemplate {
    return buildWhatsAppTemplateSend(template, params);
  }
}

function failure(message: string): { ok: false; error: { authFault: false; retryable: false; message: string } } {
  return { ok: false, error: { authFault: false, retryable: false, message } };
}
