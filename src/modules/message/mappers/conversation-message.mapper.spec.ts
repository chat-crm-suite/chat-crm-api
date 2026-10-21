// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MessageViewSchema } from '@contracts';
import type { MessageAttachment } from '../entities/message-attachment.entity';
import type { Message, TemplateSnapshot } from '../entities/message.entity';
import { toMessageView } from './conversation-message.mapper';

const templateMessage = (overrides: Partial<Message> = {}) =>
  ({
    id: 'msg-1',
    type: 'template',
    body: 'Hola Ana',
    templateId: 'tpl-1',
    templateSnapshot: null,
    ...overrides,
  }) as Message;

const snapshot = (overrides: Partial<TemplateSnapshot> = {}): TemplateSnapshot => ({
  name: 'image_cta',
  language: 'es',
  header: { kind: 'text', text: 'Pedido listo' },
  body: 'Hola Ana',
  footer: 'Gracias',
  buttons: [{ type: 'url', text: 'Ver', url: 'https://x.test/9' }],
  ...overrides,
});

/** Sent templates render natively from the snapshot stored at send time. */
describe('toMessageView (template)', () => {
  it('renders a text header, body, footer and buttons from the snapshot', () => {
    const view = toMessageView(templateMessage({ templateSnapshot: snapshot() }));

    expect(view).toEqual({
      type: 'template',
      templateId: 'tpl-1',
      name: 'image_cta',
      language: 'es',
      header: { kind: 'text', text: 'Pedido listo' },
      body: 'Hola Ana',
      footer: 'Gracias',
      buttons: [{ type: 'url', text: 'Ver', url: 'https://x.test/9' }],
      cards: [],
    });
    expect(MessageViewSchema.parse(view)).toEqual(view);
  });

  it('takes a media header file from the message attachment', () => {
    const attachment = imageAttachment('att-1', 'promo.jpg');

    const view = toMessageView(
      templateMessage({
        templateSnapshot: snapshot({
          header: { kind: 'media', mediaType: 'image', filename: 'old-name.jpg' },
        }),
      }),
      [attachment],
    );

    expect(view).toMatchObject({
      type: 'template',
      header: {
        kind: 'media',
        mediaType: 'image',
        filename: 'promo.jpg',
        media: {
          attachmentId: 'att-1',
          status: 'ready',
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
        },
      },
    });
    expect(() => MessageViewSchema.parse(view)).not.toThrow();
  });

  it('reads a media header without its file as failed (nothing to show)', () => {
    const view = toMessageView(
      templateMessage({
        templateSnapshot: snapshot({
          header: { kind: 'media', mediaType: 'document', filename: 'menu.pdf' },
        }),
      }),
    );

    expect(view).toMatchObject({
      header: {
        kind: 'media',
        filename: 'menu.pdf',
        media: { attachmentId: null, url: null, status: 'failed' },
      },
    });
  });

  it('keeps legacy rows (no snapshot, deleted template) as their text', () => {
    expect(toMessageView(templateMessage({ templateId: null }))).toEqual({
      type: 'template',
      templateId: null,
      name: '',
      language: '',
      header: null,
      body: 'Hola Ana',
      footer: null,
      buttons: [],
      cards: [],
    });
  });

  it('renders carousel cards, each with the file its snapshot names', () => {
    const card = (body: string, attachmentId: string) => ({
      header: { kind: 'media' as const, mediaType: 'image' as const, filename: null, attachmentId },
      body,
      buttons: [{ type: 'url' as const, text: 'Receta', url: 'https://x.test/r' }],
    });
    // Stored out of order on purpose: cards follow ids, never positions.
    const attachments = [imageAttachment('att-2', 'two.jpg'), imageAttachment('att-1', 'one.jpg')];

    const view = toMessageView(
      templateMessage({
        templateSnapshot: snapshot({ header: null, cards: [card('Uno', 'att-1'), card('Dos', 'att-2')] }),
      }),
      attachments,
    );

    expect(view).toMatchObject({
      type: 'template',
      header: null,
      cards: [
        { body: 'Uno', header: { filename: 'one.jpg', media: { attachmentId: 'att-1' } } },
        { body: 'Dos', header: { filename: 'two.jpg', media: { attachmentId: 'att-2' } } },
      ],
    });
    expect(() => MessageViewSchema.parse(view)).not.toThrow();
  });
});

function imageAttachment(id: string, fileName: string): MessageAttachment {
  return {
    id,
    type: 'image',
    status: 'ready',
    mimeType: 'image/jpeg',
    fileName,
    storageUrl: `/uploads/co-1/${id}.jpg`,
    sizeBytes: 2048,
    durationMs: null,
    width: 800,
    height: 600,
  } as MessageAttachment;
}
