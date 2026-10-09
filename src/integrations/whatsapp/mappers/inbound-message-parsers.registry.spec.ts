// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import type { ConversationMessage } from '../types/conversation-message.types';
import type {
  InboundMessage,
  InboundMessageContext,
} from '../types/inbound-message.types';
import type { WhatsAppWebhook } from '../types/whatsapp-webhook.types';
import {
  inboundMessageParsers,
  mapInboundWebhookToMessages,
  parseInboundMessage,
  toInboundMessage,
} from './inbound-message-parsers.registry';
import {
  mapWebhookToMessages,
  toParsedMessage,
} from './whatsapp-message.mapper';

/**
 * Ticket #20 (expand, zero behavior change): the new three-layer domain
 * (Webhook -> Inbound -> Message) and the single type-keyed parser registry
 * live beside the old names. No caller migrates here, so this spec pins
 * parity: every current inbound type resolves through the new registry to
 * the same output as today.
 *
 * Seam under test: pure parser registry
 * (`parseInboundMessage` / `toInboundMessage` /
 * `mapInboundWebhookToMessages`). Behavior is observed through return values
 * only; expected literals below are independent of the implementation.
 */
const notification = (messages: unknown[]): WhatsappNotification =>
  JSON.parse(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550001111',
                  phone_number_id: 'phone-1',
                },
                contacts: [
                  { wa_id: '15551234567', profile: { name: 'Alice' } },
                ],
                messages,
              },
            },
          ],
        },
      ],
    }),
  ) as WhatsappNotification;

const CTX: InboundMessageContext = {
  phoneNumberId: 'phone-1',
  from: '15551234567',
  messageId: 'wamid-1',
  senderName: 'Alice',
};

/** One raw provider message per known inbound type (independent literals). */
const FIXTURES: Array<{
  name: string;
  type: string;
  raw: Record<string, unknown>;
  expectedContent: Record<string, unknown>;
}> = [
  {
    name: 'text',
    type: 'text',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'text',
      text: { body: 'hola' },
    },
    expectedContent: { type: 'text', text: { body: 'hola' } },
  },
  {
    name: 'image',
    type: 'image',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'image',
      image: { id: 'media-image-1', caption: 'mira', mime_type: 'image/jpeg' },
    },
    expectedContent: {
      type: 'image',
      image: { id: 'media-image-1', caption: 'mira' },
    },
  },
  {
    name: 'document',
    type: 'document',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'document',
      document: { id: 'media-doc-1', filename: 'a.pdf' },
    },
    expectedContent: {
      type: 'document',
      document: { id: 'media-doc-1', filename: 'a.pdf' },
    },
  },
  {
    name: 'audio',
    type: 'audio',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'audio',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
    },
    expectedContent: {
      type: 'audio',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
    },
  },
  {
    name: 'video',
    type: 'video',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'video',
      video: { id: 'media-video-1', caption: 'clip' },
    },
    expectedContent: {
      type: 'video',
      video: { id: 'media-video-1', caption: 'clip' },
    },
  },
  {
    name: 'sticker',
    type: 'sticker',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'sticker',
      sticker: { id: 'media-sticker-1', mime_type: 'image/webp' },
    },
    expectedContent: {
      type: 'sticker',
      sticker: { id: 'media-sticker-1', mime_type: 'image/webp' },
    },
  },
  {
    name: 'location',
    type: 'location',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'location',
      location: { latitude: 4.60971, longitude: -74.08175, name: 'Oficina' },
    },
    expectedContent: {
      type: 'location',
      location: { latitude: 4.60971, longitude: -74.08175, name: 'Oficina' },
    },
  },
  {
    name: 'contacts',
    type: 'contacts',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'contacts',
      contacts: [{ name: { formatted_name: 'Juan Pérez' } }],
    },
    expectedContent: {
      type: 'contact',
      contacts: [{ name: { formatted_name: 'Juan Pérez' } }],
    },
  },
  {
    name: 'interactive',
    type: 'interactive',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-yes', title: 'Sí' },
      },
    },
    expectedContent: {
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-yes', title: 'Sí' },
      },
    },
  },
  {
    name: 'reaction',
    type: 'reaction',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'reaction',
      reaction: { message_id: 'wamid-target-1', emoji: '👍' },
    },
    expectedContent: {
      type: 'reaction',
      reaction: { message_id: 'wamid-target-1', emoji: '👍' },
    },
  },
  {
    name: 'button (legacy)',
    type: 'button',
    raw: {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'button',
      button: { payload: 'btn-confirm', text: 'Confirmar' },
    },
    expectedContent: {
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-confirm', title: 'Confirmar' },
      },
    },
  },
];

describe('inbound parser registry parity (ticket #20 expand)', () => {
  it('exposes the three domain layers as importable types', () => {
    // Layer 1 (provider-raw webhook) -> layer 2 (normalized inbound) ->
    // layer 3 (persisted conversation message). Type-only: a missing layer
    // breaks compilation, which is the assertion.
    const webhook: WhatsAppWebhook | null = null;
    const inbound: InboundMessage | null = null;
    const stored: ConversationMessage | null = null;

    expect(webhook).toBeNull();
    expect(inbound).toBeNull();
    expect(stored).toBeNull();
  });

  it('registers one parser per current inbound type', () => {
    for (const { type } of FIXTURES) {
      expect(inboundMessageParsers[type]).toBeDefined();
    }
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    'parseInboundMessage matches the legacy output for %s',
    (_name, { raw, expectedContent }) => {
      const fresh = parseInboundMessage(raw, { ...CTX });

      expect(fresh).toBeDefined();
      expect(fresh?.context).toEqual({ ...CTX });
      expect(fresh?.content).toMatchObject(expectedContent);
      expect(fresh).toEqual(
        toParsedMessage(raw, CTX.phoneNumberId, CTX.senderName),
      );
    },
  );

  it('drops unknown provider types through the registry like today', () => {
    const raw = {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'order',
    };

    expect(parseInboundMessage(raw, { ...CTX })).toBeUndefined();
    expect(
      toParsedMessage(raw, CTX.phoneNumberId, CTX.senderName),
    ).toBeUndefined();
    expect(mapInboundWebhookToMessages(notification([raw])).messages).toEqual(
      mapWebhookToMessages(notification([raw])).messages,
    );
    expect(
      mapInboundWebhookToMessages(notification([raw])).messages,
    ).toHaveLength(0);
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    'mapInboundWebhookToMessages matches the legacy webhook output for %s',
    (_name, { raw }) => {
      const payload = notification([{ ...raw }]);

      expect(mapInboundWebhookToMessages(payload)).toEqual(
        mapWebhookToMessages(payload),
      );
      expect(mapInboundWebhookToMessages(payload).messages).toHaveLength(1);
    },
  );

  it('toInboundMessage rehydrates a stored payload like the legacy path', () => {
    const stored = {
      id: 'wamid-1',
      from: '15551234567',
      timestamp: '1760000000',
      type: 'text',
      text: { body: 'hola' },
    };

    expect(toInboundMessage(stored, 'phone-1', 'Alice')).toEqual(
      toParsedMessage(stored, 'phone-1', 'Alice'),
    );
    expect(toInboundMessage(null, 'phone-1')).toBeUndefined();
    expect(toParsedMessage(null, 'phone-1')).toBeUndefined();
  });
});
