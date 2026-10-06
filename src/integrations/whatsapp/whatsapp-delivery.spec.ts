// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  ChannelsService,
  ChannelTransmission,
} from '../../modules/channels/channels.service';
import type { WhatsAppClient } from './clients/whatsapp.client';
import type { WhatsAppPayload } from './interfaces/whatsapp-message.interface';
import { WhatsAppService } from './whatsapp.service';

/**
 * T5: `deliverMessage` is the send path that hands the outcome back to the
 * outbound row (response or classified error), so a failed send can persist
 * its code/message instead of dying in a log.
 */
const payload: WhatsAppPayload = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '15551234567',
  type: 'text',
  text: { body: 'hola' },
};

const transmission = {
  channel: { id: 'chan-1', companyId: 'co-1' },
  credentials: { accessToken: 'token-1' },
} as unknown as ChannelTransmission;

const axiosError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status ${status}`), {
    isAxiosError: true,
    response: { status, data },
    config: {},
  });

function build() {
  const channels = { getTransmissionForCompany: jest.fn() };
  const client = { send: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('co-1') };
  const commandBus = { execute: jest.fn().mockResolvedValue(undefined) };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const service = new WhatsAppService(
    channels as unknown as ChannelsService,
    client as unknown as WhatsAppClient,
    cls as never,
    commandBus as never,
    logger as never,
  );

  return { service, channels, client, commandBus, logger };
}

describe('WhatsAppService.deliverMessage (T5 send outcome)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the Graph response through the company transmission', async () => {
    const { service, channels, client } = build();
    channels.getTransmissionForCompany.mockResolvedValue(transmission);
    client.send.mockResolvedValue({ messages: [{ id: 'wamid-1' }] });

    await expect(service.deliverMessage(payload, 'co-1')).resolves.toEqual({
      ok: true,
      response: { messages: [{ id: 'wamid-1' }] },
    });

    expect(client.send).toHaveBeenCalledWith(payload, transmission);
  });

  it('returns the classified error instead of swallowing it', async () => {
    const { service, channels, client, commandBus } = build();
    channels.getTransmissionForCompany.mockResolvedValue(transmission);
    client.send.mockRejectedValue(
      axiosError(401, {
        error: { type: 'OAuthException', code: 190, message: 'expired token' },
      }),
    );

    await expect(service.deliverMessage(payload, 'co-1')).resolves.toEqual({
      ok: false,
      error: {
        authFault: true,
        retryable: false,
        code: '190',
        message: 'expired token',
      },
    });

    // The legacy failure command belongs to `sendMessage`; the T5 caller owns
    // the persistence of the failure.
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('reports a missing channel as a delivery failure, never a silent drop', async () => {
    const { service, channels, client } = build();
    channels.getTransmissionForCompany.mockResolvedValue(null);

    await expect(service.deliverMessage(payload, 'co-1')).resolves.toEqual({
      ok: false,
      error: {
        authFault: false,
        retryable: false,
        message: 'WhatsApp channel not configured',
      },
    });
    expect(client.send).not.toHaveBeenCalled();
  });
});
