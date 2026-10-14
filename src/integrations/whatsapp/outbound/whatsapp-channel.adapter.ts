// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  ChannelsService,
  type ChannelTransmission,
} from '@modules/channels/channels.service';
import type {
  ChannelAdapter,
  ChannelFailure,
  ChannelOutcome,
  ResolvedOutgoing,
  StoredMedia,
} from '@modules/channels/ports/channel-adapter.port';
import { ChannelAdapterRegistry } from '@modules/channels/ports/channel-adapter.registry';
import {
  WhatsAppClient,
  classifyWhatsAppError,
} from '../clients/whatsapp.client';
import { toWhatsAppPayload } from './whatsapp-payload';

/**
 * Graph codes meaning the 24 h customer-service window is closed: only an
 * approved template can reach the customer again.
 */
const REPLY_WINDOW_CLOSED_CODES = new Set(['131047']);

/**
 * WhatsApp Cloud API behind the channel port: resolves the channel's
 * transmission, uploads media to Graph and sends the translated payload.
 * Every failure comes back as a classified `ChannelFailure`, never thrown.
 */
@Injectable()
export class WhatsAppChannelAdapter implements ChannelAdapter, OnModuleInit {
  readonly type = 'whatsapp' as const;

  constructor(
    private readonly channels: ChannelsService,
    private readonly client: WhatsAppClient,
    private readonly registry: ChannelAdapterRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppChannelAdapter.name);
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async uploadMedia(
    channelId: string,
    file: StoredMedia,
  ): Promise<ChannelOutcome<{ providerMediaId: string }>> {
    return this.withTransmission(channelId, async (transmission) => ({
      ok: true,
      providerMediaId: await this.client.uploadMedia(transmission, file),
    }));
  }

  async send(
    channelId: string,
    recipient: string,
    message: ResolvedOutgoing,
  ): Promise<ChannelOutcome<{ externalId: string }>> {
    return this.withTransmission(channelId, async (transmission) => {
      const response = await this.client.send(
        toWhatsAppPayload(recipient, message),
        transmission,
      );
      const externalId = response?.messages?.[0]?.id;

      return externalId
        ? { ok: true, externalId }
        : failure({ message: 'WhatsApp send answered without a wamid' });
    });
  }

  /** Runs a Graph operation on an active channel, classifying any fault. */
  private async withTransmission<T>(
    channelId: string,
    operation: (
      transmission: ChannelTransmission,
    ) => Promise<ChannelOutcome<T>>,
  ): Promise<ChannelOutcome<T>> {
    const transmission = await this.channels.getTransmissionByChannelId(
      channelId,
    );
    if (!transmission || transmission.channel.status !== 'active') {
      return failure({ message: 'WhatsApp channel not configured' });
    }

    try {
      return await operation(transmission);
    } catch (error: unknown) {
      const info = classifyWhatsAppError(error);
      this.logger.error(
        { channelId, code: info.code, authFault: info.authFault },
        'WhatsApp request failed',
      );

      return {
        ok: false,
        error: {
          ...info,
          replyWindowClosed: REPLY_WINDOW_CLOSED_CODES.has(info.code ?? ''),
        },
      };
    }
  }
}

function failure(
  error: Partial<ChannelFailure> & Pick<ChannelFailure, 'message'>,
): { ok: false; error: ChannelFailure } {
  return {
    ok: false,
    error: { authFault: false, retryable: false, ...error },
  };
}
