// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import { mapWebhookToMessages } from './whatsapp-message.mapper';

/**
 * T2 row-first persist: the mapper is the seam that turns the raw webhook
 * payload into the messages the pipeline persists. Every known inbound type
 * must survive it, so nothing reaches the intake row and then silently dies.
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

describe('mapWebhookToMessages (T2 inbound types)', () => {
  it('parses an inbound audio message with its media reference', () => {
    const payload = notification([
      {
        id: 'wamid-audio-1',
        from: '15551234567',
        timestamp: '1760000000',
        type: 'audio',
        audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].context).toMatchObject({
      messageId: 'wamid-audio-1',
      phoneNumberId: 'phone-1',
      from: '15551234567',
      senderName: 'Alice',
    });
    expect(messages[0].content).toMatchObject({
      type: 'audio',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' },
    });
  });

  it('parses an inbound video message with caption and filename', () => {
    const payload = notification([
      {
        id: 'wamid-video-1',
        from: '15551234567',
        timestamp: '1760000001',
        type: 'video',
        video: {
          id: 'media-video-1',
          caption: 'mira esto',
          filename: 'clip.mp4',
          mime_type: 'video/mp4',
        },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'video',
      video: {
        id: 'media-video-1',
        caption: 'mira esto',
        filename: 'clip.mp4',
        mime_type: 'video/mp4',
      },
    });
  });

  it('parses an inbound sticker message with its media reference', () => {
    const payload = notification([
      {
        id: 'wamid-sticker-1',
        from: '15551234567',
        timestamp: '1760000002',
        type: 'sticker',
        sticker: {
          id: 'media-sticker-1',
          animated: true,
          mime_type: 'image/webp',
          sha256: 'abc',
        },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'sticker',
      sticker: { id: 'media-sticker-1', mime_type: 'image/webp' },
    });
  });

  it('parses an inbound location message with its coordinates', () => {
    const payload = notification([
      {
        id: 'wamid-location-1',
        from: '15551234567',
        timestamp: '1760000003',
        type: 'location',
        location: {
          latitude: 4.60971,
          longitude: -74.08175,
          name: 'Oficina',
          address: 'Calle 123 #45-67',
        },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'location',
      location: {
        latitude: 4.60971,
        longitude: -74.08175,
        name: 'Oficina',
        address: 'Calle 123 #45-67',
      },
    });
  });

  it('parses an inbound contacts message with name and phone', () => {
    const payload = notification([
      {
        id: 'wamid-contacts-1',
        from: '15551234567',
        timestamp: '1760000004',
        type: 'contacts',
        contacts: [
          {
            name: {
              formatted_name: 'Juan Pérez',
              first_name: 'Juan',
              last_name: 'Pérez',
            },
            phones: [{ phone: '+57 300 1234567', type: 'CELL' }],
            emails: [{ email: 'juan@example.com' }],
          },
        ],
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'contact',
      contacts: [
        {
          name: { formatted_name: 'Juan Pérez' },
          phones: [{ phone: '+57 300 1234567' }],
        },
      ],
    });
  });

  it('parses an inbound interactive button reply', () => {
    const payload = notification([
      {
        id: 'wamid-interactive-1',
        from: '15551234567',
        timestamp: '1760000005',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn-yes', title: 'Sí' },
        },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-yes', title: 'Sí' },
      },
    });
  });

  it('parses an inbound reaction with its emoji and target message', () => {
    const payload = notification([
      {
        id: 'wamid-reaction-1',
        from: '15551234567',
        timestamp: '1760000006',
        type: 'reaction',
        reaction: { message_id: 'wamid-target-1', emoji: '👍' },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'reaction',
      reaction: { message_id: 'wamid-target-1', emoji: '👍' },
    });
  });

  it('parses a legacy button reply as an interactive content', () => {
    const payload = notification([
      {
        id: 'wamid-button-1',
        from: '15551234567',
        timestamp: '1760000007',
        type: 'button',
        button: { payload: 'btn-confirm', text: 'Confirmar' },
      },
    ]);

    const { messages } = mapWebhookToMessages(payload);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn-confirm', title: 'Confirmar' },
      },
    });
  });
});
