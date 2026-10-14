// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MessageRepository } from './message.repository';
import { MessageService } from './message.service';
import type { MessageAttachment } from './entities/message-attachment.entity';
import type { Message } from './entities/message.entity';

const message = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg-1',
    conversationId: 'conv-1',
    type: 'text',
    senderType: 'customer',
    senderMemberId: null,
    senderCustomerId: 'cust-1',
    body: 'hola',
    status: 'delivered',
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  }) as Message;

const attachment = (
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment =>
  ({
    id: 'att-1',
    messageId: 'msg-1',
    type: 'image',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    storageUrl: '/uploads/photo.jpg',
    status: 'ready',
    sizeBytes: 2048,
    ...overrides,
  }) as MessageAttachment;

const readyMedia = {
  attachmentId: 'att-1',
  url: '/attachments/att-1',
  status: 'ready',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  durationMs: null,
  width: null,
  height: null,
};

describe('MessageService.getMessagePayload', () => {
  const findById = jest.fn();
  const findAttachmentsByMessageIds = jest.fn();
  const service = new MessageService({
    findById,
    findAttachmentsByMessageIds,
  } as unknown as MessageRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes an image through our attachments endpoint', async () => {
    findById.mockResolvedValue(message({ type: 'image', body: 'Mira' }));
    findAttachmentsByMessageIds.mockResolvedValue([attachment()]);

    const payload = await service.getMessagePayload('msg-1');

    expect(findAttachmentsByMessageIds).toHaveBeenCalledWith(['msg-1']);
    expect(payload).toEqual({
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: null,
      timestamp: new Date('2026-10-05T00:00:00.000Z'),
      status: 'delivered',
      sender: { id: 'cust-1', type: 'customer' },
      msg: { type: 'image', media: readyMedia, caption: 'Mira' },
    });
  });

  it('includes the filename and caption for documents', async () => {
    findById.mockResolvedValue(message({ type: 'document', body: null }));
    findAttachmentsByMessageIds.mockResolvedValue([attachment()]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toEqual({
      type: 'document',
      media: readyMedia,
      filename: 'photo.jpg',
      caption: null,
    });
  });

  it('maps text rows to their text', async () => {
    findById.mockResolvedValue(message({ type: 'text' }));
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toEqual({ type: 'text', text: 'hola' });
  });

  it('marks ogg audio as a voice note with its duration', async () => {
    findById.mockResolvedValue(message({ type: 'audio', body: null }));
    findAttachmentsByMessageIds.mockResolvedValue([
      attachment({
        type: 'audio',
        mimeType: 'audio/ogg; codecs=opus',
        fileName: 'a.ogg',
        durationMs: 4200,
      }),
    ]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toMatchObject({
      type: 'audio',
      voice: true,
      media: { url: '/attachments/att-1', durationMs: 4200 },
    });
  });

  it('keeps an mp3 as a plain audio file', async () => {
    findById.mockResolvedValue(message({ type: 'audio', body: null }));
    findAttachmentsByMessageIds.mockResolvedValue([
      attachment({ type: 'audio', mimeType: 'audio/mpeg' }),
    ]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toMatchObject({ type: 'audio', voice: false });
  });

  it('exposes a failed media row without url', async () => {
    findById.mockResolvedValue(message({ type: 'image' }));
    findAttachmentsByMessageIds.mockResolvedValue([
      attachment({ status: 'failed', storageUrl: undefined }),
    ]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toMatchObject({
      type: 'image',
      media: { status: 'failed', url: null },
    });
  });

  it('reads a media row without attachment as failed', async () => {
    findById.mockResolvedValue(message({ type: 'sticker', body: null }));
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toMatchObject({
      type: 'sticker',
      media: { status: 'failed', url: null, attachmentId: null },
    });
  });

  it('returns null when the message does not exist', async () => {
    findById.mockResolvedValue(null);

    await expect(service.getMessagePayload('missing')).resolves.toBeNull();
    expect(findAttachmentsByMessageIds).not.toHaveBeenCalled();
  });

  it('carries the client message id so the front reconciles the optimistic row', async () => {
    findById.mockResolvedValue(message({ clientMessageId: 'client-1' }));
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.clientMessageId).toBe('client-1');
  });

  it('maps kinds without a renderer to the unsupported view, keeping their text', async () => {
    findById.mockResolvedValue(
      message({
        type: 'location',
        body: '📍 Oficina: 4.60971, -74.08175',
      }),
    );
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toEqual({
      type: 'unsupported',
      originalType: 'location',
      text: '📍 Oficina: 4.60971, -74.08175',
    });
  });
});
