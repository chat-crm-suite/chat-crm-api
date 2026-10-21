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

  it('maps a template: positional values by order, named ones by name, URL buttons by index', () => {
    expect(
      toWhatsAppPayload('51999000111', {
        type: 'template',
        name: 'order_update',
        language: 'es',
        header: [{ key: 'customer', value: 'Ana' }],
        body: [
          { key: '1', value: '#123' },
          { key: '2', value: 'lunes' },
        ],
        buttons: [{ index: 0, subType: 'url', parameters: [{ key: '1', value: 'abc' }] }],
      }),
    ).toEqual({
      ...base,
      type: 'template',
      template: {
        name: 'order_update',
        language: { code: 'es' },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'text', text: 'Ana', parameter_name: 'customer' }],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: '#123' },
              { type: 'text', text: 'lunes' },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: 'abc' }],
          },
        ],
      },
    });
  });

  it('omits components for a template without placeholders', () => {
    expect(
      toWhatsAppPayload('51999000111', {
        type: 'template',
        name: 'hello_world',
        language: 'en_US',
        header: [],
        body: [],
        buttons: [],
      }),
    ).toEqual({
      ...base,
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
  });

  it.each([
    ['image', undefined, { type: 'image', image: { id: 'media-1' } }],
    ['video', undefined, { type: 'video', video: { id: 'media-1' } }],
    [
      'document',
      'menu.pdf',
      { type: 'document', document: { id: 'media-1', filename: 'menu.pdf' } },
    ],
  ] as const)('sends a %s header as its Graph media id', (type, filename, parameter) => {
    const payload = toWhatsAppPayload('51999000111', {
      type: 'template',
      name: 'promo',
      language: 'es',
      header: [],
      body: [{ key: '1', value: 'Ana' }],
      buttons: [],
      headerMedia: {
        type,
        media: { providerMediaId: 'media-1', mimeType: 'application/octet-stream' },
        ...(filename ? { filename } : {}),
      },
    });

    expect(payload).toEqual({
      ...base,
      type: 'template',
      template: {
        name: 'promo',
        language: { code: 'es' },
        components: [
          { type: 'header', parameters: [parameter] },
          { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
        ],
      },
    });
  });
});
