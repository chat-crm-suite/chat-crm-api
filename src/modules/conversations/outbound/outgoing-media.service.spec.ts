// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { NotFoundException } from '@nestjs/common';

import type { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import type { AgentSendJob } from '../commands/send-conversation-message.command';
import { OutgoingMediaService } from './outgoing-media.service';

const job = (msg: AgentSendJob['msg']): AgentSendJob => ({
  room: 'conv-1',
  companyId: 'co-1',
  clientMessageId: 'client-1',
  sender: { id: 'member-1', type: 'member' },
  msg,
});

const sticker = {
  id: 'att-9',
  type: 'sticker',
  status: 'ready',
  storageUrl: '/uploads/co-1/s.webp',
  mimeType: 'image/webp',
  fileName: 's.webp',
  sizeBytes: 40_000,
  width: 512,
  height: 512,
} as MessageAttachment;

function build() {
  const staged = { consume: jest.fn() };
  const storage = { resolve: jest.fn((_company: string, url: string) => `/root${url}`) };
  const messages = {
    findAttachmentContext: jest.fn(),
    findAttachments: jest.fn(),
    rememberProviderMedia: jest.fn(),
  };
  const service = new OutgoingMediaService(
    staged as never,
    storage as never,
    messages as never,
  );
  return { service, staged, messages };
}

describe('OutgoingMediaService', () => {
  it('consumes the staged upload scoped to the conversation and kind', async () => {
    const { service, staged } = build();
    staged.consume.mockResolvedValue({
      storageUrl: '/uploads/co-1/u.png',
      mimeType: 'image/png',
      filename: 'u.png',
      sizeBytes: 10,
      durationMs: null,
      width: 1,
      height: 1,
    });

    await service.prepare(
      job({ type: 'image', uploadId: '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b' }),
    );

    expect(staged.consume).toHaveBeenCalledWith(
      '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b',
      { companyId: 'co-1', scope: 'conversation:conv-1', kind: 'image' },
    );
  });

  it("consumes a template's header file scoped to the template and kind", async () => {
    const { service, staged } = build();
    staged.consume.mockResolvedValue({
      storageUrl: '/uploads/co-1/h.jpg',
      mimeType: 'image/jpeg',
      filename: 'h.jpg',
      sizeBytes: 10,
      durationMs: null,
      width: 1,
      height: 1,
    });

    await expect(
      service.prepareTemplateHeader('0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b', {
        companyId: 'co-1',
        templateId: 'tpl-1',
        kind: 'image',
      }),
    ).resolves.toMatchObject({ storageUrl: '/uploads/co-1/h.jpg', filename: 'h.jpg' });
    expect(staged.consume).toHaveBeenCalledWith(
      '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b',
      { companyId: 'co-1', scope: 'template:tpl-1', kind: 'image' },
    );
  });

  it('re-sends a stored sticker of the same company', async () => {
    const { service, messages } = build();
    messages.findAttachmentContext.mockResolvedValue({
      attachment: sticker,
      message: { companyId: 'co-1' },
    });

    await expect(
      service.prepare(job({ type: 'sticker', source: { attachmentId: 'att-9' } })),
    ).resolves.toMatchObject({
      storageUrl: '/uploads/co-1/s.webp',
      mimeType: 'image/webp',
      width: 512,
    });
  });

  it("never re-sends another company's file or a non-sticker", async () => {
    const { service, messages } = build();
    const send = () =>
      service.prepare(job({ type: 'sticker', source: { attachmentId: 'att-9' } }));

    messages.findAttachmentContext.mockResolvedValueOnce({
      attachment: sticker,
      message: { companyId: 'co-2' },
    });
    await expect(send()).rejects.toBeInstanceOf(NotFoundException);

    messages.findAttachmentContext.mockResolvedValueOnce({
      attachment: { ...sticker, type: 'image' },
      message: { companyId: 'co-1' },
    });
    await expect(send()).rejects.toBeInstanceOf(NotFoundException);

    messages.findAttachmentContext.mockResolvedValueOnce(null);
    await expect(send()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uploads a file to the provider once and remembers its id', async () => {
    const { service, messages } = build();
    const adapter = {
      uploadMedia: jest.fn().mockResolvedValue({ ok: true, providerMediaId: 'media-1' }),
    };
    const target = { channelId: 'channel-1', companyId: 'co-1' };

    await expect(
      service.toProvider(adapter as never, target, sticker),
    ).resolves.toEqual({ ok: true, providerMediaId: 'media-1' });
    expect(adapter.uploadMedia).toHaveBeenCalledWith('channel-1', {
      absolutePath: '/root/uploads/co-1/s.webp',
      mimeType: 'image/webp',
      filename: 's.webp',
      sizeBytes: 40_000,
    });
    expect(messages.rememberProviderMedia).toHaveBeenCalledWith('att-9', 'media-1');

    adapter.uploadMedia.mockClear();
    await expect(
      service.toProvider(adapter as never, target, {
        ...sticker,
        externalMediaId: 'media-1',
      } as MessageAttachment),
    ).resolves.toEqual({ ok: true, providerMediaId: 'media-1' });
    expect(adapter.uploadMedia).not.toHaveBeenCalled();
  });
});
