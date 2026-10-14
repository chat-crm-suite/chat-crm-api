// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStorageService } from '@modules/media/attachment-storage.service';
import {
  MediaNormalizerChain,
  type MediaNormalizer,
} from '@modules/media/normalize/media-normalizer';
import { StagedUploadStore } from '@modules/media/staging/staged-upload.store';
import type { ConversationSendContextService } from '../send-context/conversation-send-context.service';
import { ConversationUploadsService } from './conversation-uploads.service';

const u16le = (value: number) => [value & 0xff, value >> 8];
const u32be = (value: number) => [0, 0, value >> 8, value & 0xff];
const text = (value: string) => [...Buffer.from(value, 'latin1')];

const png = (width = 640, height = 480) =>
  Buffer.from([
    0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13), ...text('IHDR'), ...u32be(width), ...u32be(height),
  ]);

const webpSticker = (size: number, padding = 0) =>
  Buffer.from([
    ...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'), ...text('VP8 '), 0, 0, 0, 0,
    0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(size), ...u16le(size),
    ...new Array<number>(padding).fill(0),
  ]);

const memoryCache = () => {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => Promise.resolve(store.set(key, value)),
    del: (key: string) => Promise.resolve(store.delete(key)),
  };
};

/** Turns `audio/webm` into `audio/ogg`, like the real voice-note remuxer. */
const fakeRemuxer: MediaNormalizer = {
  supports: (mimeType, accepted) =>
    mimeType === 'audio/webm' && accepted.includes('audio/ogg'),
  normalize: () => ({
    data: Buffer.from('OggS-remuxed'),
    mimeType: 'audio/ogg',
    extension: 'ogg',
    durationMs: 4200,
  }),
};

/**
 * An agent's file is checked against what the conversation's channel takes:
 * content-sniffed type, per-kind size, sticker geometry; voice notes are
 * normalized; the result is staged under the company storage.
 */
describe('ConversationUploadsService', () => {
  let root: string;
  let incoming: string;
  let service: ConversationUploadsService;
  let store: StagedUploadStore;
  const sendContext = { get: jest.fn() };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uploads-root-'));
    incoming = mkdtempSync(join(tmpdir(), 'uploads-in-'));
    store = new StagedUploadStore(
      new AttachmentStorageService(root),
      memoryCache() as never,
    );
    service = new ConversationUploadsService(
      sendContext as unknown as ConversationSendContextService,
      store,
      new MediaNormalizerChain([fakeRemuxer]),
    );
    sendContext.get.mockResolvedValue({
      conversationId: 'conv-1',
      companyId: 'co-1',
      channelId: 'channel-1',
      channelType: 'whatsapp',
      recipient: '51999000111',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(incoming, { recursive: true, force: true });
  });

  const upload = (content: Buffer, mimetype: string, originalname: string) => {
    const path = join(incoming, `${Math.random()}`);
    writeFileSync(path, content);
    return { path, size: content.length, mimetype, originalname };
  };

  it('stages an image with its sniffed type, dimensions and safe name', async () => {
    const file = upload(png(), 'image/png', 'C:\\fotos\\Mi foto.PNG');

    const staged = await service.stage('conv-1', 'co-1', file, { kind: 'image' });

    expect(staged).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: file.size,
      filename: 'Mi foto.png',
      width: 640,
      height: 480,
      durationMs: null,
    });
    expect(existsSync(join(root, 'co-1', 'staged', `${staged.uploadId}.png`))).toBe(true);
    expect(staged.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses content that does not match a supported type', async () => {
    const exe = upload(Buffer.from('MZ\x90\x00'), 'image/png', 'virus.png');

    await expect(
      service.stage('conv-1', 'co-1', exe, { kind: 'image' }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('refuses a type the channel does not take for that kind', async () => {
    // WhatsApp images are jpeg/png only: a gif must go as a document… which
    // does not accept it either.
    const gif = upload(Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/gif', 'a.gif');

    await expect(
      service.stage('conv-1', 'co-1', gif, { kind: 'image' }),
    ).rejects.toThrow('image/gif cannot be sent as image');
  });

  it('refuses files over the per-kind limit', async () => {
    const big = upload(png(), 'image/png', 'big.png');
    big.size = 6 * 1024 * 1024;

    await expect(
      service.stage('conv-1', 'co-1', big, { kind: 'image' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('refuses channels that cannot send media', async () => {
    sendContext.get.mockResolvedValue({
      conversationId: 'conv-1',
      companyId: 'co-1',
      channelId: 'channel-2',
      channelType: 'telegram',
      recipient: '1',
    });

    await expect(
      service.stage('conv-1', 'co-1', upload(png(), 'image/png', 'a.png'), {
        kind: 'image',
      }),
    ).rejects.toThrow('This channel cannot send image files');
  });

  it('refuses a conversation of another company', async () => {
    await expect(
      service.stage('conv-1', 'co-2', upload(png(), 'image/png', 'a.png'), {
        kind: 'image',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a 512x512 webp sticker within the static size cap', async () => {
    const staged = await service.stage(
      'conv-1',
      'co-1',
      upload(webpSticker(512), 'image/webp', 'sticker.webp'),
      { kind: 'sticker' },
    );

    expect(staged).toMatchObject({ kind: 'sticker', width: 512, height: 512 });
  });

  it('refuses stickers with the wrong size or weight', async () => {
    await expect(
      service.stage(
        'conv-1',
        'co-1',
        upload(webpSticker(256), 'image/webp', 's.webp'),
        { kind: 'sticker' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.stage(
        'conv-1',
        'co-1',
        upload(webpSticker(512, 101 * 1024), 'image/webp', 's.webp'),
        { kind: 'sticker' },
      ),
    ).rejects.toThrow('Static stickers are limited to 102400 bytes');
  });

  it('normalizes a Chrome voice recording into the channel voice format', async () => {
    const webm = upload(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]),
      'audio/webm;codecs=opus',
      'nota.webm',
    );

    const staged = await service.stage('conv-1', 'co-1', webm, {
      kind: 'audio',
      durationMs: 4000,
    });

    expect(staged).toMatchObject({
      mimeType: 'audio/ogg',
      filename: 'nota.ogg',
      sizeBytes: 'OggS-remuxed'.length,
      // The remuxer measured it: more precise than the recorder's clock.
      durationMs: 4200,
    });
    expect(existsSync(join(root, 'co-1', 'staged', `${staged.uploadId}.ogg`))).toBe(true);
    // The normalized temp copy never lingers.
    expect(existsSync(`${webm.path}.normalized`)).toBe(false);
  });
});

describe('StagedUploadStore.consume', () => {
  let root: string;
  let store: StagedUploadStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'staged-'));
    store = new StagedUploadStore(
      new AttachmentStorageService(root),
      memoryCache() as never,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const stage = () => {
    const sourcePath = join(root, 'incoming');
    writeFileSync(sourcePath, 'file');
    return store.stage({
      companyId: 'co-1',
      conversationId: 'conv-1',
      kind: 'document',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      filename: 'a.pdf',
      extension: 'pdf',
      durationMs: null,
      width: null,
      height: null,
      sourcePath,
    });
  };

  const scope = { companyId: 'co-1', conversationId: 'conv-1', kind: 'document' } as const;

  it('moves the file out of staging, idempotently', async () => {
    const staged = await stage();

    const first = await store.consume(staged.uploadId, scope);
    const second = await store.consume(staged.uploadId, scope);

    expect(first.storageUrl).toBe(`/uploads/co-1/${staged.uploadId}.pdf`);
    expect(second).toEqual(first);
    expect(existsSync(join(root, 'co-1', `${staged.uploadId}.pdf`))).toBe(true);
    expect(existsSync(join(root, 'co-1', 'staged', `${staged.uploadId}.pdf`))).toBe(false);
  });

  it('never hands an upload to another conversation, company or kind', async () => {
    const staged = await stage();

    for (const wrong of [
      { ...scope, conversationId: 'conv-2' },
      { ...scope, companyId: 'co-2' },
      { ...scope, kind: 'image' as const },
    ]) {
      await expect(store.consume(staged.uploadId, wrong)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    await expect(store.consume('unknown', scope)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
