// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MessageViewSchema } from './message.contract';
import {
  SendTemplateSchema,
  type TemplateComponent,
  templateHeaderMedia,
  templateSendSupport,
} from './template.contract';

const body: TemplateComponent = { type: 'body', text: 'Hola {{1}}' };
const header = (format: TemplateComponent['format'], text: string | null = null) =>
  ({ type: 'header', format, text }) satisfies TemplateComponent;

describe('template contract', () => {
  describe('templateHeaderMedia', () => {
    it.each(['image', 'video', 'document'] as const)('reads a %s header as its file kind', (format) => {
      expect(templateHeaderMedia([header(format), body])).toBe(format);
    });

    it('is null for text, location or no header', () => {
      expect(templateHeaderMedia([header('text', 'Hi'), body])).toBeNull();
      expect(templateHeaderMedia([header('location'), body])).toBeNull();
      expect(templateHeaderMedia([body])).toBeNull();
    });
  });

  describe('templateSendSupport', () => {
    it('sends text and media headers on a channel that takes the file', () => {
      expect(templateSendSupport([header('text', 'Hi'), body], 'whatsapp')).toEqual({
        ok: true,
        reason: null,
      });
      expect(templateSendSupport([header('image'), body], 'whatsapp')).toEqual({
        ok: true,
        reason: null,
      });
    });

    it('refuses carousels and location headers', () => {
      expect(templateSendSupport([body, { type: 'carousel' }], 'whatsapp')).toEqual({
        ok: false,
        reason: 'carousel',
      });
      expect(templateSendSupport([header('location'), body], 'whatsapp')).toEqual({
        ok: false,
        reason: 'location_header',
      });
    });

    it('refuses a header file on a channel without capabilities for it', () => {
      expect(templateSendSupport([header('video'), body], 'telegram')).toEqual({
        ok: false,
        reason: 'header_media_unsupported',
      });
    });
  });

  it('accepts a header file reference on a send', () => {
    const uploadId = '0b9f6a3e-5c1d-4f7e-9a2b-3c4d5e6f7a8b';
    expect(SendTemplateSchema.parse({ templateId: 't-1', headerMedia: { uploadId } })).toMatchObject({
      headerMedia: { uploadId },
      params: {},
    });
    expect(() =>
      SendTemplateSchema.parse({ templateId: 't-1', headerMedia: { uploadId: 'nope' } }),
    ).toThrow();
  });

  it('parses a sent template view with a media header', () => {
    const view = {
      type: 'template',
      templateId: null,
      name: 'promo',
      language: 'es',
      header: {
        kind: 'media',
        mediaType: 'image',
        media: {
          attachmentId: 'att-1',
          url: '/attachments/att-1',
          status: 'ready',
          mimeType: 'image/jpeg',
          sizeBytes: 10,
          durationMs: null,
          width: null,
          height: null,
        },
        filename: 'promo.jpg',
      },
      body: 'Hola Ana',
      footer: null,
      buttons: [{ type: 'url', text: 'Ver', url: 'https://x.test/1' }],
    };
    expect(MessageViewSchema.parse(view)).toEqual(view);
  });
});
