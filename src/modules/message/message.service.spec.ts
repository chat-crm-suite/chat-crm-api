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
    messageId: 'msg-1',
    type: 'image',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    storageUrl: '/uploads/photo.jpg',
    status: 'ready',
    sizeBytes: 2048,
    ...overrides,
  }) as MessageAttachment;

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

  it('includes the attachment storageUrl as mediaUrl for images', async () => {
    findById.mockResolvedValue(message({ type: 'image' }));
    findAttachmentsByMessageIds.mockResolvedValue([attachment()]);

    const payload = await service.getMessagePayload('msg-1');

    expect(findAttachmentsByMessageIds).toHaveBeenCalledWith(['msg-1']);
    expect(payload).toMatchObject({
      id: 'msg-1',
      conversationId: 'conv-1',
      msg: {
        type: 'image',
        mediaUrl: '/uploads/photo.jpg',
      },
    });
  });

  it('includes the filename for documents', async () => {
    findById.mockResolvedValue(message({ type: 'document' }));
    findAttachmentsByMessageIds.mockResolvedValue([attachment()]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg.mediaUrl).toBe('/uploads/photo.jpg');
    expect(payload?.msg.content.filename).toBe('photo.jpg');
    expect(payload?.msg.mimeType).toBe('image/jpeg');
    expect(payload?.msg.sizeBytes).toBe(2048);
  });

  it('returns null mediaUrl for text without attachments', async () => {
    findById.mockResolvedValue(message({ type: 'text' }));
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg).toMatchObject({
      type: 'text',
      content: { body: 'hola' },
    });
    expect(payload?.msg.mediaUrl).toBeNull();
    expect(payload?.msg.mimeType).toBeUndefined();
    expect(payload?.msg.sizeBytes).toBeUndefined();
  });

  it('falls back to the generic mapper for types without strategy', async () => {
    findById.mockResolvedValue(message({ type: 'audio' }));
    findAttachmentsByMessageIds.mockResolvedValue([attachment()]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg.type).toBe('audio');
    expect(payload?.msg.mediaUrl).toBe('/uploads/photo.jpg');
  });

  it('exposes the attachment status for a failed media row', async () => {
    findById.mockResolvedValue(message({ type: 'image' }));
    findAttachmentsByMessageIds.mockResolvedValue([
      attachment({ status: 'failed', storageUrl: undefined }),
    ]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.msg.attachmentStatus).toBe('failed');
    expect(payload?.msg.mediaUrl).toBeNull();
  });

  it('returns null when the message does not exist', async () => {
    findById.mockResolvedValue(null);

    await expect(service.getMessagePayload('missing')).resolves.toBeNull();
    expect(findAttachmentsByMessageIds).not.toHaveBeenCalled();
  });

  it('maps an audio row to the unchanged broadcast shape with mediaUrl', async () => {
    findById.mockResolvedValue(message({ type: 'audio', body: null }));
    findAttachmentsByMessageIds.mockResolvedValue([
      attachment({ type: 'audio', mimeType: 'audio/ogg', storageUrl: '/uploads/a.ogg', fileName: 'a.ogg' }),
    ]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload).toMatchObject({
      id: 'msg-1',
      conversationId: 'conv-1',
      msg: { type: 'audio', mediaUrl: '/uploads/a.ogg', content: {} },
    });
    expect(Object.keys(payload as object).sort()).toEqual([
      'clientMessageId',
      'conversationId',
      'id',
      'msg',
      'sender',
      'status',
      'timestamp',
    ]);
  });

  it('carries the client message id so the front reconciles the optimistic row', async () => {
    findById.mockResolvedValue(message({ clientMessageId: 'client-1' }));
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload?.clientMessageId).toBe('client-1');
  });

  it('maps a location row to a readable body row', async () => {
    findById.mockResolvedValue(
      message({
        type: 'location',
        body: '📍 Oficina: 4.60971, -74.08175',
      }),
    );
    findAttachmentsByMessageIds.mockResolvedValue([]);

    const payload = await service.getMessagePayload('msg-1');

    expect(payload).toMatchObject({
      msg: {
        type: 'location',
        mediaUrl: null,
        content: { body: '📍 Oficina: 4.60971, -74.08175' },
      },
    });
  });
});
