import { of, throwError } from 'rxjs';

import { SaveConversationMessageCommand } from '../../../../modules/conversations/commands/save-conversation-message.command';
import type { ConversationMessageDto } from '../../../../modules/conversations/dto/conversation-message.dto';
import type { ChannelTransmission } from '../../../../modules/channels/channels.service';
import { MessageContentHandlers } from './message-content.handlers';

/**
 * T2 row-first persist: every known inbound type must reach the save command
 * as a visible row. Media types carry their downloaded URL, and a failed
 * download never drops the row (caption/text survives).
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
  const client = {
    setChannel: jest.fn(),
    upload: jest
      .fn()
      .mockReturnValue(
        of({ fileUrl: '/uploads/media-1.ogg', mimeType: 'audio/ogg', size: 10 }),
      ),
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
    client as never,
    commandBus as never,
    logger as never,
  );

  return { handlers, conversations, client, commandBus, logger };
}

const savedPayload = (
  execute: jest.Mock<Promise<unknown>, [unknown]>,
): ConversationMessageDto | undefined => {
  const command = execute.mock.calls[0]?.[0];

  return command instanceof SaveConversationMessageCommand
    ? command.data
    : undefined;
};

describe('MessageContentHandlers (T2 inbound types)', () => {
  it('persists an audio message as a playable row with its media URL', async () => {
    const { handlers, client, commandBus } = build();

    await handlers.getHandler('audio')?.handle(
      {
        type: 'audio',
        audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
      },
      context(),
      transmission(),
    );

    expect(client.setChannel).toHaveBeenCalled();
    expect(client.upload).toHaveBeenCalledWith(
      'media-audio-1',
      'token-1',
      undefined,
    );
    expect(commandBus.execute).toHaveBeenCalledTimes(1);

    expect(savedPayload(commandBus.execute)).toMatchObject({
      room: 'conv-1',
      companyId: 'co-1',
      sender: { id: 'cust-1', type: 'customer' },
      msg: {
        type: 'audio',
        mediaUrl: '/uploads/media-1.ogg',
        externalId: 'wamid-1',
        externalMediaId: 'media-audio-1',
        mimeType: 'audio/ogg',
        content: { link: '/uploads/media-1.ogg' },
      },
    });
  });

  it('still persists the row when the media download fails', async () => {
    const { handlers, client, commandBus, logger } = build();
    client.upload.mockReturnValue(throwError(() => new Error('graph down')));

    await handlers.getHandler('audio')?.handle(
      {
        type: 'audio',
        audio: { id: 'media-audio-1', mime_type: 'audio/ogg' },
      },
      context(),
      transmission(),
    );

    const payload = savedPayload(commandBus.execute);
    expect(payload).toMatchObject({
      msg: {
        type: 'audio',
        externalId: 'wamid-1',
        externalMediaId: 'media-audio-1',
      },
    });
    expect(payload?.msg.mediaUrl).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('persists an image with caption and media URL', async () => {
    const { handlers, client, commandBus } = build();
    client.upload.mockReturnValue(
      of({ fileUrl: '/uploads/img.jpg', mimeType: 'image/jpeg', size: 10 }),
    );

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
        mediaUrl: '/uploads/img.jpg',
        externalMediaId: 'media-img-1',
        mimeType: 'image/jpeg',
        content: { link: '/uploads/img.jpg', caption: 'mira' },
      },
    });
  });

  it('persists a document with filename and caption', async () => {
    const { handlers, client, commandBus } = build();
    client.upload.mockReturnValue(
      of({ fileUrl: '/uploads/doc.pdf', mimeType: 'application/pdf', size: 10 }),
    );

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

    expect(client.upload).toHaveBeenCalledWith(
      'media-doc-1',
      'token-1',
      'pdf',
    );
    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'document',
        mediaUrl: '/uploads/doc.pdf',
        content: {
          link: '/uploads/doc.pdf',
          caption: 'factura',
          filename: 'factura.pdf',
        },
      },
    });
  });

  it('persists a video with caption and filename', async () => {
    const { handlers, client, commandBus } = build();
    client.upload.mockReturnValue(
      of({ fileUrl: '/uploads/clip.mp4', mimeType: 'video/mp4', size: 10 }),
    );

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
        mediaUrl: '/uploads/clip.mp4',
        content: {
          link: '/uploads/clip.mp4',
          caption: 'mira esto',
          filename: 'clip.mp4',
        },
      },
    });
  });

  it('persists a sticker as a media row', async () => {
    const { handlers, client, commandBus } = build();
    client.upload.mockReturnValue(
      of({ fileUrl: '/uploads/sticker.webp', mimeType: 'image/webp', size: 10 }),
    );

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
        mediaUrl: '/uploads/sticker.webp',
        externalMediaId: 'media-sticker-1',
      },
    });
  });

  it('persists the row even when the media has no reference at all', async () => {
    const { handlers, client, commandBus } = build();

    await handlers.getHandler('image')?.handle(
      { type: 'image', image: { caption: 'foto sin archivo' } },
      context(),
      transmission(),
    );

    expect(client.upload).not.toHaveBeenCalled();
    expect(savedPayload(commandBus.execute)).toMatchObject({
      msg: {
        type: 'image',
        content: { caption: 'foto sin archivo' },
      },
    });
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
