// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ChannelTransmission } from '@modules/channels/channels.service';
import { ChannelAdapterRegistry } from '@modules/channels/ports/channel-adapter.registry';
import { WhatsAppChannelAdapter } from './whatsapp-channel.adapter';

const transmission = (status = 'active') =>
  ({
    channel: { id: 'channel-1', status, externalAccountId: 'phone-1' },
    credentials: { accessToken: 'token' },
  }) as unknown as ChannelTransmission;

const graphError = (status: number, code: number, message: string) =>
  Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { error: { code, message } } },
  });

function build() {
  const channels = {
    getTransmissionByChannelId: jest.fn().mockResolvedValue(transmission()),
  };
  const client = { send: jest.fn(), uploadMedia: jest.fn() };
  const registry = new ChannelAdapterRegistry();
  const logger = { error: jest.fn(), setContext: jest.fn() };
  const adapter = new WhatsAppChannelAdapter(
    channels as never,
    client as never,
    registry,
    logger as never,
  );

  return { adapter, channels, client, registry };
}

/**
 * The WhatsApp side of the channel port: it resolves the channel's own
 * transmission, translates the message and turns every Graph fault into a
 * classified failure instead of throwing.
 */
describe('WhatsAppChannelAdapter', () => {
  it('registers itself for the whatsapp channel type', () => {
    const { adapter, registry } = build();

    adapter.onModuleInit();

    expect(registry.for('whatsapp')).toBe(adapter);
  });

  it("sends the translated payload with the channel's transmission", async () => {
    const { adapter, channels, client } = build();
    client.send.mockResolvedValue({ messages: [{ id: 'wamid-1' }] });

    await expect(
      adapter.send('channel-1', '51999000111', { type: 'text', text: 'Hola' }),
    ).resolves.toEqual({ ok: true, externalId: 'wamid-1' });

    expect(channels.getTransmissionByChannelId).toHaveBeenCalledWith('channel-1');
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '51999000111',
        type: 'text',
        text: { body: 'Hola' },
      }),
      transmission(),
    );
  });

  it('fails without a wamid in the answer', async () => {
    const { adapter, client } = build();
    client.send.mockResolvedValue({});

    await expect(
      adapter.send('channel-1', '51999000111', { type: 'text', text: 'Hola' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'WhatsApp send answered without a wamid' },
    });
  });

  it('refuses an inactive or missing channel without calling Graph', async () => {
    const { adapter, channels, client } = build();
    channels.getTransmissionByChannelId.mockResolvedValueOnce(
      transmission('inactive'),
    );

    await expect(
      adapter.send('channel-1', '51999000111', { type: 'text', text: 'Hola' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'WhatsApp channel not configured' },
    });

    channels.getTransmissionByChannelId.mockResolvedValueOnce(null);
    await expect(
      adapter.uploadMedia('channel-1', {
        absolutePath: '/tmp/a.png',
        mimeType: 'image/png',
        filename: 'a.png',
        sizeBytes: 10,
      }),
    ).resolves.toMatchObject({ ok: false });

    expect(client.send).not.toHaveBeenCalled();
    expect(client.uploadMedia).not.toHaveBeenCalled();
  });

  it('flags the closed 24 h window so the app can offer a template', async () => {
    const { adapter, client } = build();
    client.send.mockRejectedValue(
      graphError(400, 131047, 'Re-engagement message'),
    );

    await expect(
      adapter.send('channel-1', '51999000111', { type: 'text', text: 'Hola' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        authFault: false,
        retryable: false,
        code: '131047',
        message: 'Re-engagement message',
        replyWindowClosed: true,
      },
    });
  });

  it('classifies an authorization fault as not retryable', async () => {
    const { adapter, client } = build();
    client.send.mockRejectedValue(graphError(401, 190, 'expired token'));

    await expect(
      adapter.send('channel-1', '51999000111', { type: 'text', text: 'Hola' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { authFault: true, retryable: false, replyWindowClosed: false },
    });
  });

  it('returns the Graph media id of an upload', async () => {
    const { adapter, client } = build();
    client.uploadMedia.mockResolvedValue('media-1');
    const file = {
      absolutePath: '/tmp/a.png',
      mimeType: 'image/png',
      filename: 'a.png',
      sizeBytes: 10,
    };

    await expect(adapter.uploadMedia('channel-1', file)).resolves.toEqual({
      ok: true,
      providerMediaId: 'media-1',
    });
    expect(client.uploadMedia).toHaveBeenCalledWith(transmission(), file);
  });
});
