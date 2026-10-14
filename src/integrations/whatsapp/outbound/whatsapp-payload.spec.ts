// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { toWhatsAppPayload } from './whatsapp-payload';

const base = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '51999000111',
};

const media = { providerMediaId: 'media-1', mimeType: 'image/jpeg' };

/**
 * One mapping per kind, Graph shape exact: media is referenced by the id of
 * its upload (never a public link) and empty optionals are omitted.
 */
describe('toWhatsAppPayload', () => {
  it('maps text', () => {
    expect(toWhatsAppPayload('51999000111', { type: 'text', text: 'Hola' })).toEqual({
      ...base,
      type: 'text',
      text: { body: 'Hola' },
    });
  });

  it('maps an image with and without caption', () => {
    expect(
      toWhatsAppPayload('51999000111', { type: 'image', media, caption: 'Foto' }),
    ).toEqual({ ...base, type: 'image', image: { id: 'media-1', caption: 'Foto' } });
    expect(toWhatsAppPayload('51999000111', { type: 'image', media })).toEqual({
      ...base,
      type: 'image',
      image: { id: 'media-1' },
    });
  });

  it('maps a video with caption', () => {
    expect(
      toWhatsAppPayload('51999000111', { type: 'video', media, caption: 'Clip' }),
    ).toEqual({ ...base, type: 'video', video: { id: 'media-1', caption: 'Clip' } });
  });

  it('maps audio and voice notes without caption', () => {
    expect(
      toWhatsAppPayload('51999000111', { type: 'audio', media, voice: true }),
    ).toEqual({ ...base, type: 'audio', audio: { id: 'media-1' } });
  });

  it('maps a document with its filename', () => {
    expect(
      toWhatsAppPayload('51999000111', {
        type: 'document',
        media,
        filename: 'cotizacion.pdf',
      }),
    ).toEqual({
      ...base,
      type: 'document',
      document: { id: 'media-1', filename: 'cotizacion.pdf' },
    });
  });

  it('maps a sticker', () => {
    expect(toWhatsAppPayload('51999000111', { type: 'sticker', media })).toEqual({
      ...base,
      type: 'sticker',
      sticker: { id: 'media-1' },
    });
  });
});
