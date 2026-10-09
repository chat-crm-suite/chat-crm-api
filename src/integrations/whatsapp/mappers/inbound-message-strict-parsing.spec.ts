// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import type {
  InboundDiscard,
  InboundMessageContext,
} from '../types/inbound-message.types';
import {
  mapInboundWebhookToMessages,
  parseInboundMessage,
} from './inbound-message-parsers.registry';

/**
 * Ticket #21 (strict parsing): the new registry validates required fields
 * per type. Missing essentials yield discard (`undefined`), never invented
 * defaults (no empty bodies, no media without id).
 *
 * Seam under test: pure parser registry (`parseInboundMessage`). Behavior is
 * observed through return values only; no logging, no event bus here — the
 * publishing border owns those effects (covered by the border service spec).
 */
const CTX: InboundMessageContext = {
  phoneNumberId: 'phone-1',
  from: '15551234567',
  messageId: 'wamid-1',
  senderName: 'Alice',
};

const base = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 'wamid-1',
  from: '15551234567',
  timestamp: '1760000000',
  ...extra,
});

describe('strict inbound parsers (ticket #21)', () => {
  describe('text', () => {
    it('keeps a text message with a non-empty body', () => {
      const parsed = parseInboundMessage(
        base({ type: 'text', text: { body: 'hola' } }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'text',
        text: { body: 'hola' },
      });
    });

    it('discards text without a body instead of inventing an empty one', () => {
      expect(
        parseInboundMessage(base({ type: 'text' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(base({ type: 'text', text: {} }), { ...CTX }),
      ).toBeUndefined();
    });

    it('discards text with an empty or blank body', () => {
      expect(
        parseInboundMessage(base({ type: 'text', text: { body: '' } }), {
          ...CTX,
        }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(base({ type: 'text', text: { body: '   ' } }), {
          ...CTX,
        }),
      ).toBeUndefined();
    });
  });

  describe('media (image)', () => {
    it('keeps an image carrying its provider media id', () => {
      const parsed = parseInboundMessage(
        base({
          type: 'image',
          image: { id: 'media-image-1', caption: 'mira' },
        }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'image',
        image: { id: 'media-image-1', caption: 'mira' },
      });
    });

    it('discards an image without a media id', () => {
      expect(
        parseInboundMessage(
          base({ type: 'image', image: { caption: 'sin id' } }),
          { ...CTX },
        ),
      ).toBeUndefined();
    });

    it('discards an image without its payload', () => {
      expect(
        parseInboundMessage(base({ type: 'image' }), { ...CTX }),
      ).toBeUndefined();
    });
  });

  describe.each([
    ['document', 'document', 'media-doc-1'],
    ['audio', 'audio', 'media-audio-1'],
    ['video', 'video', 'media-video-1'],
    ['sticker', 'sticker', 'media-sticker-1'],
  ])('media (%s)', (_name, type, mediaId) => {
    it('keeps the payload carrying its provider media id', () => {
      const parsed = parseInboundMessage(
        base({ type, [type]: { id: mediaId } }),
        { ...CTX },
      );

      expect(parsed?.content).toMatchObject({
        type,
        [type]: { id: mediaId },
      });
    });

    it('discards the payload without a media id', () => {
      expect(
        parseInboundMessage(base({ type, [type]: { caption: 'sin id' } }), {
          ...CTX,
        }),
      ).toBeUndefined();
      expect(parseInboundMessage(base({ type }), { ...CTX })).toBeUndefined();
    });
  });

  describe('location', () => {
    it('keeps a location with numeric coordinates', () => {
      const parsed = parseInboundMessage(
        base({
          type: 'location',
          location: { latitude: 4.60971, longitude: -74.08175, name: 'Ofi' },
        }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'location',
        location: { latitude: 4.60971, longitude: -74.08175, name: 'Ofi' },
      });
    });

    it('discards a location without numeric coordinates', () => {
      expect(
        parseInboundMessage(base({ type: 'location' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(
          base({ type: 'location', location: { name: 'sin coords' } }),
          { ...CTX },
        ),
      ).toBeUndefined();
      expect(
        parseInboundMessage(
          base({
            type: 'location',
            location: { latitude: '4.6', longitude: -74.08 },
          }),
          { ...CTX },
        ),
      ).toBeUndefined();
    });
  });

  describe('contacts', () => {
    it('keeps a non-empty contact list', () => {
      const parsed = parseInboundMessage(
        base({
          type: 'contacts',
          contacts: [{ name: { formatted_name: 'Juan Pérez' } }],
        }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'contact',
        contacts: [{ name: { formatted_name: 'Juan Pérez' } }],
      });
    });

    it('discards an empty or missing contact list', () => {
      expect(
        parseInboundMessage(base({ type: 'contacts' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(base({ type: 'contacts', contacts: [] }), {
          ...CTX,
        }),
      ).toBeUndefined();
    });
  });

  describe('button (legacy)', () => {
    it('keeps a button reply carrying payload or text', () => {
      const parsed = parseInboundMessage(
        base({ type: 'button', button: { payload: 'btn-ok', text: 'Ok' } }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn-ok', title: 'Ok' },
        },
      });
    });

    it('discards a button without payload nor text', () => {
      expect(
        parseInboundMessage(base({ type: 'button' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(base({ type: 'button', button: {} }), {
          ...CTX,
        }),
      ).toBeUndefined();
    });
  });

  describe('interactive', () => {
    it('keeps a button reply with id and title', () => {
      const parsed = parseInboundMessage(
        base({
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: { id: 'btn-yes', title: 'Sí' },
          },
        }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn-yes', title: 'Sí' },
        },
      });
    });

    it('discards a missing interactive payload', () => {
      expect(
        parseInboundMessage(base({ type: 'interactive' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(base({ type: 'interactive', interactive: {} }), {
          ...CTX,
        }),
      ).toBeUndefined();
    });
  });

  describe('reaction', () => {
    it('keeps a reaction with its target message', () => {
      const parsed = parseInboundMessage(
        base({
          type: 'reaction',
          reaction: { message_id: 'wamid-target-1', emoji: '👍' },
        }),
        { ...CTX },
      );

      expect(parsed?.content).toEqual({
        type: 'reaction',
        reaction: { message_id: 'wamid-target-1', emoji: '👍' },
      });
    });

    it('discards a missing reaction payload', () => {
      expect(
        parseInboundMessage(base({ type: 'reaction' }), { ...CTX }),
      ).toBeUndefined();
      expect(
        parseInboundMessage(
          base({ type: 'reaction', reaction: { emoji: '👍' } }),
          { ...CTX },
        ),
      ).toBeUndefined();
    });
  });
});

const webhookWith = (value: unknown): WhatsappNotification =>
  JSON.parse(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'messages', value }] }],
    }),
  ) as WhatsappNotification;

const textMessage = (id = 'wamid-1'): Record<string, unknown> => ({
  id,
  from: '15551234567',
  timestamp: '1760000000',
  type: 'text',
  text: { body: 'hola' },
});

const METADATA: Record<string, unknown> = {
  display_phone_number: '15550001111',
  phone_number_id: 'phone-1',
};

const messageValue = (
  messages: unknown[],
  metadata?: unknown,
): Record<string, unknown> => {
  const value: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: '15551234567', profile: { name: 'Alice' } }],
    messages,
  };
  // An omitted argument means the provider sent no metadata at all; an
  // explicit object (possibly channel-less) is kept as sent.
  if (metadata !== undefined) value.metadata = metadata;
  return value;
};

const validValue = (messages: unknown[]): Record<string, unknown> =>
  messageValue(messages, { ...METADATA });

describe('malformed webhook degradation (ticket #21)', () => {
  it('answers empty to a non-object or foreign body without throwing', () => {
    for (const body of [null, undefined, {}, { object: 'other' }]) {
      expect(mapInboundWebhookToMessages(body as never).messages).toEqual([]);
    }
  });

  it('answers empty when the entry list is missing without throwing', () => {
    const noEntry = { object: 'whatsapp_business_account' };
    const nullEntry = { object: 'whatsapp_business_account', entry: null };

    expect(mapInboundWebhookToMessages(noEntry as never).messages).toEqual([]);
    expect(mapInboundWebhookToMessages(nullEntry as never).messages).toEqual(
      [],
    );
  });

  it('skips entries without a changes list without throwing', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1' }, null],
    };

    expect(mapInboundWebhookToMessages(body as never).messages).toEqual([]);
  });

  it('omits the messages of a value without metadata without throwing', () => {
    const { messages } = mapInboundWebhookToMessages(
      webhookWith(messageValue([textMessage()])),
    );

    expect(messages).toEqual([]);
  });

  it('omits the messages of a value without a channel id without throwing', () => {
    const { messages } = mapInboundWebhookToMessages(
      webhookWith(messageValue([textMessage()], {})),
    );

    expect(messages).toEqual([]);
  });

  it('still collects statuses when no message survives', () => {
    const { messages, statuses } = mapInboundWebhookToMessages(
      webhookWith({
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '15550001111',
          phone_number_id: 'phone-1',
        },
        statuses: [
          {
            id: 'wamid-out-1',
            status: 'delivered',
            timestamp: '1760000001',
            recipient_id: '15551234567',
          },
        ],
      }),
    );

    expect(messages).toEqual([]);
    expect(statuses).toHaveLength(1);
  });
});

describe('discard facts (ticket #21)', () => {
  const collectDiscards = (
    messages: unknown[],
    metadata?: unknown,
  ): { parsed: unknown[]; seen: InboundDiscard[] } => {
    const seen: InboundDiscard[] = [];
    const { messages: parsed } = mapInboundWebhookToMessages(
      webhookWith(messageValue(messages, metadata)),
      (fact) => seen.push(fact),
    );

    return { parsed, seen };
  };

  it('notifies no discard for a valid message', () => {
    const { parsed, seen } = collectDiscards([textMessage()], {
      ...METADATA,
    });

    expect(parsed).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it('notifies unknown provider types with their type', () => {
    const { parsed, seen } = collectDiscards([base({ type: 'order' })], {
      ...METADATA,
    });

    expect(parsed).toEqual([]);
    expect(seen).toEqual([
      { messageId: 'wamid-1', type: 'order', reason: 'unknown-type' },
    ]);
  });

  it('notifies the per-type reason for invalid payloads', () => {
    const { seen } = collectDiscards(
      [
        base({ type: 'text', text: { body: '' } }),
        base({ id: 'wamid-img', type: 'image', image: {} }),
        base({ id: 'wamid-loc', type: 'location', location: {} }),
      ],
      { ...METADATA },
    );

    expect(seen).toEqual([
      { messageId: 'wamid-1', type: 'text', reason: 'missing-text-body' },
      { messageId: 'wamid-img', type: 'image', reason: 'missing-media-id' },
      {
        messageId: 'wamid-loc',
        type: 'location',
        reason: 'missing-location-coordinates',
      },
    ]);
  });

  it('notifies one fact per discarded message through the webhook border', () => {
    const seen: Array<{ messageId: string; type: string; reason: string }> = [];
    const { messages } = mapInboundWebhookToMessages(
      webhookWith(
        validValue([
          textMessage('wamid-ok'),
          base({ id: 'wamid-empty', type: 'text', text: { body: '' } }),
          base({ id: 'wamid-order', type: 'order' }),
        ]),
      ),
      (fact) => {
        seen.push(fact);
      },
    );

    expect(messages.map((m) => m.context.messageId)).toEqual(['wamid-ok']);
    expect(seen).toEqual([
      { messageId: 'wamid-empty', type: 'text', reason: 'missing-text-body' },
      { messageId: 'wamid-order', type: 'order', reason: 'unknown-type' },
    ]);
  });

  it('notifies a missing-channel-id fact for messages under metadata-less values', () => {
    const seen: Array<{ messageId: string; type: string; reason: string }> = [];
    const { messages } = mapInboundWebhookToMessages(
      webhookWith(messageValue([textMessage()])),
      (fact) => {
        seen.push(fact);
      },
    );

    expect(messages).toEqual([]);
    expect(seen).toEqual([
      { messageId: 'wamid-1', type: 'text', reason: 'missing-channel-id' },
    ]);
  });
});
