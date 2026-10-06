// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { SaveConversationMessageCommand } from '../../../../modules/conversations/commands/save-conversation-message.command';
import type { ConversationMessageDto } from '../../../../modules/conversations/dto/conversation-message.dto';
import type { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { MessageContentHandlers } from './message-content.handlers';

/**
 * T3 row-first persist: every known inbound type reaches the save command as
 * a visible row, and media types keep their reference (`externalMediaId`) for
 * the async enrichment. Nothing is downloaded inline, so a media failure can
 * never delay or drop the row.
 */
const transmission = (): ChannelTransmission =>
  ({
    channel: {
      id: 'chan-1',
      companyId: 'co-1',
      externalAccountId: 'phone-1',
      settings: {},
    },
    credentials: { accessToken: 'token-1' },
  }) as unknown as ChannelTransmission;

const context = () => ({
  phoneNumberId: 'phone-1',
  from: '15551234567',
  messageId: 'wamid-1',
  senderName: 'Alice',
});

function build() {
  const conversations = {
    findOrCreateIncoming: jest.fn().mockResolvedValue({
      conversation: { id: 'conv-1' },
      customer: { id: 'cust-1' },
    }),
  };
  const commandBus = {
    execute: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(undefined),
  };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };
  const handlers = new MessageContentHandlers(
    conversations as never,
    commandBus as never,
    logger as never,
  );

  return { handlers, conversations, commandBus, logger };
}

const savedPayload = (
  execute: jest.Mock<Promise<unknown>, [unknown]>,
): ConversationMessageDto | undefined => {
  const command = execute.mock.calls[0]?.[0];

  return command instanceof SaveConversationMessageCommand
    ? command.data
    : undefined;
};

describe('MessageContentHandlers (T3 pending media reference)', () => {
  it('persists an audio message as a row with its media reference (no download)', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('audio')?.handle(
      {
        type: 'audio',
        audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
      },
      context(),
      transmission(),
    );

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(savedPayload(commandBus.execute)).toMatchObject({
      room: 'conv-1',
      companyId: 'co-1',
      sender: { id: 'cust-1', type: 'customer' },
      msg: {
        type: 'audio',
        externalId: 'wamid-1',
        externalMediaId: 'media-audio-1',
        mimeType: 'audio/ogg; codecs=opus',
        content: {},
      },
    });
    expect(savedPayload(commandBus.execute)?.msg.mediaUrl).toBeUndefined();
  });

  it('persists an image with caption and media reference', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('image')?.handle(
      {
        type: 'image',
        image: { id: 'media-img-1', caption: 'mira', mime_type: 'image/jpeg' },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'image',
        externalMediaId: 'media-img-1',
        mimeType: 'image/jpeg',
        content: { caption: 'mira' },
      },
    });
    expect(savedPayload(commandBus.execute)?.msg.mediaUrl).toBeUndefined();
  });

  it('persists a document with filename and caption', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('document')?.handle(
      {
        type: 'document',
        document: {
          id: 'media-doc-1',
          caption: 'factura',
          filename: 'factura.pdf',
          sha256: 'abc',
          mime_type: 'application/pdf',
        },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'document',
        externalMediaId: 'media-doc-1',
        mimeType: 'application/pdf',
        content: {
          caption: 'factura',
          filename: 'factura.pdf',
        },
      },
    });
  });

  it('persists a video with caption and filename', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('video')?.handle(
      {
        type: 'video',
        video: {
          id: 'media-video-1',
          caption: 'mira esto',
          filename: 'clip.mp4',
          mime_type: 'video/mp4',
        },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'video',
        externalMediaId: 'media-video-1',
        mimeType: 'video/mp4',
        content: {
          caption: 'mira esto',
          filename: 'clip.mp4',
        },
      },
    });
  });

  it('persists a sticker as a media row with its reference', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('sticker')?.handle(
      {
        type: 'sticker',
        sticker: { id: 'media-sticker-1', mime_type: 'image/webp' },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'sticker',
        externalMediaId: 'media-sticker-1',
        mimeType: 'image/webp',
      },
    });
  });

  it('persists the row even when the media has no reference at all', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('image')?.handle(
      { type: 'image', image: { caption: 'foto sin archivo' } },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'image',
        content: { caption: 'foto sin archivo' },
      },
    });
    expect(savedPayload(commandBus.execute)?.msg.externalMediaId).toBeUndefined();
  });

  it('persists a location as a short readable row', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('location')?.handle(
      {
        type: 'location',
        location: {
          latitude: 4.60971,
          longitude: -74.08175,
          name: 'Oficina',
        },
      },
      context(),
      transmission(),
    );

    const payload = savedPayload(commandBus.execute);
    expect(payload).toMatchObject({
      msg: {
        type: 'location',
        externalId: 'wamid-1',
        content: { body: '📍 Oficina: 4.60971, -74.08175' },
      },
    });
    expect(payload?.msg.mediaUrl).toBeUndefined();
  });

  it('persists a contact card as a short readable row', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('contact')?.handle(
      {
        type: 'contact',
        contacts: [
          {
            name: { formatted_name: 'Juan Pérez' },
            phones: [{ phone: '+57 300 1234567' }],
          },
        ],
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'contact',
        content: { body: '👤 Juan Pérez · +57 300 1234567' },
      },
    });
  });

  it('persists a button reply as a short readable row', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('interactive')?.handle(
      {
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn-1', title: 'Sí' },
        },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: { type: 'interactive', content: { body: '🔘 Sí' } },
    });
  });

  it('persists a reaction as a short readable row', async () => {
    const { handlers, commandBus } = build();

    await handlers.getHandler('reaction')?.handle(
      {
        type: 'reaction',
        reaction: { message_id: 'wamid-target-1', emoji: '👍' },
      },
      context(),
      transmission(),
    );

    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: { type: 'reaction', content: { body: 'Reacción: 👍' } },
    });
  });
});
