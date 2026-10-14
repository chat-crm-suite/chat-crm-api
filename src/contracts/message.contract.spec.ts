// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  MAX_UPLOAD_BYTES,
  channelCapabilities,
} from './channel.contract';
import {
  ConversationMessageSchema,
  MessageViewSchema,
  OutgoingMessageSchema,
  SendMessageAckSchema,
} from './message.contract';

const UPLOAD_ID = '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b';

const readyMedia = {
  attachmentId: 'att-1',
  url: '/attachments/att-1',
  status: 'ready',
  mimeType: 'image/png',
  sizeBytes: 1024,
  durationMs: null,
  width: 640,
  height: 480,
} as const;

describe('message contract (v3)', () => {
  describe('OutgoingMessageSchema', () => {
    it('accepts one payload per sendable kind', () => {
      const payloads = [
        { type: 'text', text: 'Hola' },
        { type: 'image', uploadId: UPLOAD_ID, caption: 'Foto' },
        { type: 'video', uploadId: UPLOAD_ID },
        { type: 'audio', uploadId: UPLOAD_ID, voice: true },
        { type: 'document', uploadId: UPLOAD_ID, filename: 'cotizacion.pdf' },
        { type: 'sticker', source: { uploadId: UPLOAD_ID } },
        { type: 'sticker', source: { attachmentId: 'att-1' } },
      ];

      for (const payload of payloads) {
        expect(OutgoingMessageSchema.safeParse(payload).success).toBe(true);
      }
    });

    it('rejects content that does not match its type', () => {
      expect(
        OutgoingMessageSchema.safeParse({ type: 'image', text: 'Hola' }).success,
      ).toBe(false);
      expect(
        OutgoingMessageSchema.safeParse({ type: 'document', uploadId: UPLOAD_ID })
          .success,
      ).toBe(false);
    });

    it('rejects blank text and kinds that cannot be sent', () => {
      expect(
        OutgoingMessageSchema.safeParse({ type: 'text', text: '   ' }).success,
      ).toBe(false);
      expect(
        OutgoingMessageSchema.safeParse({ type: 'location', uploadId: UPLOAD_ID })
          .success,
      ).toBe(false);
    });

    it('trims the text it accepts', () => {
      expect(
        OutgoingMessageSchema.parse({ type: 'text', text: '  Hola  ' }),
      ).toEqual({ type: 'text', text: 'Hola' });
    });
  });

  describe('MessageViewSchema', () => {
    it('parses media views and the unsupported fallback', () => {
      expect(
        MessageViewSchema.safeParse({
          type: 'image',
          media: readyMedia,
          caption: null,
        }).success,
      ).toBe(true);
      expect(
        MessageViewSchema.safeParse({
          type: 'unsupported',
          originalType: 'location',
          text: null,
        }).success,
      ).toBe(true);
    });

    it('requires the media reference on media views', () => {
      expect(
        MessageViewSchema.safeParse({ type: 'audio', voice: true }).success,
      ).toBe(false);
    });
  });

  it('coerces the message timestamp', () => {
    const message = ConversationMessageSchema.parse({
      id: 'msg-1',
      conversationId: 'conv-1',
      clientMessageId: null,
      timestamp: '2026-10-13T10:00:00.000Z',
      status: 'sent',
      sender: { id: 'member-1', type: 'member' },
      msg: { type: 'text', text: 'Hola' },
    });

    expect(message.timestamp).toBeInstanceOf(Date);
  });

  it('acknowledges sends as ok or as a typed failure', () => {
    expect(SendMessageAckSchema.safeParse({ ok: true }).success).toBe(true);
    expect(
      SendMessageAckSchema.safeParse({
        ok: false,
        code: 'forbidden',
        message: 'Conversation access denied',
      }).success,
    ).toBe(true);
    expect(SendMessageAckSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('channel capabilities', () => {
  it('describes WhatsApp media limits', () => {
    const whatsapp = channelCapabilities('whatsapp');

    expect(whatsapp?.media.image?.maxBytes).toBe(5 * 1024 * 1024);
    expect(whatsapp?.media.sticker?.mimeTypes).toEqual(['image/webp']);
    expect(whatsapp?.voiceMimeType).toBe('audio/ogg');
    expect(whatsapp?.replyWindowMs).toBe(24 * 60 * 60 * 1000);
  });

  it('has no capabilities for channels without an adapter', () => {
    expect(channelCapabilities('telegram')).toBeNull();
    expect(channelCapabilities(undefined)).toBeNull();
  });

  it('caps uploads at the largest media rule', () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });
});
