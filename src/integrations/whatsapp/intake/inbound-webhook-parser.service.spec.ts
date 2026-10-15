// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import { InboundMessageReceivedEvent } from '../events/inbound-message-received.event';
import { InboundWebhookParserService } from './inbound-webhook-parser.service';

/**
 * Ticket #21 (publishing border): pure parsers never log or publish — this
 * thin service wraps them with the event bus. Every discard publishes
 * exactly one discard fact (message id, type, reason); every normalized
 * message publishes exactly one received fact; structural degradation
 * (missing entry, metadata or channel id) warns instead of throwing, so the
 * webhook is always answered without a 500.
 *
 * Seam under test: `InboundWebhookParserService.parseWebhook` with a mocked
 * `EventBus` (`publish: jest.fn()`) and a mocked logger. Behavior is
 * observed through the return value plus the mocked calls.
 */
const METADATA = {
  display_phone_number: '15550001111',
  phone_number_id: 'phone-1',
};

const textMessage = (id = 'wamid-1'): Record<string, unknown> => ({
  id,
  from: '15551234567',
  timestamp: '1760000000',
  type: 'text',
  text: { body: 'hola' },
});

const webhookWith = (value: unknown): WhatsappNotification =>
  JSON.parse(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'messages', value }] }],
    }),
  ) as WhatsappNotification;

const valueWith = (
  messages: unknown[],
  metadata?: unknown,
): Record<string, unknown> => {
  const value: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: '15551234567', profile: { name: 'Alice' } }],
    messages,
  };
  if (metadata !== undefined) value.metadata = metadata;
  return value;
};

describe('InboundWebhookParserService (ticket #21 border)', () => {
  let publish: jest.Mock;
  let published: unknown[];
  let warn: jest.Mock;
  let service: InboundWebhookParserService;

  beforeEach(() => {
    published = [];
    publish = jest.fn((event: unknown) => {
      published.push(event);
    });
    warn = jest.fn();
    service = new InboundWebhookParserService(
      { publish } as never,
      { setContext: jest.fn(), warn } as never,
    );
  });

  it('publishes exactly one received fact per normalized message', () => {
    const result = service.parseWebhook(
      webhookWith(valueWith([textMessage()], { ...METADATA })),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].context).toMatchObject({
      messageId: 'wamid-1',
      phoneNumberId: 'phone-1',
      senderName: 'Alice',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(published[0]).toBeInstanceOf(InboundMessageReceivedEvent);
    expect(published[0]).toMatchObject({ messageId: 'wamid-1', type: 'text' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('publishes exactly one discard fact per discarded message', () => {
    const result = service.parseWebhook(
      webhookWith(
        valueWith(
          [
            textMessage('wamid-ok'),
            {
              id: 'wamid-empty',
              from: '15551234567',
              timestamp: '1760000000',
              type: 'text',
              text: { body: '' },
            },
            {
              id: 'wamid-order',
              from: '15551234567',
              timestamp: '1760000000',
              type: 'order',
            },
          ],
          { ...METADATA },
        ),
      ),
    );

    expect(result.messages.map((m) => m.context.messageId)).toEqual([
      'wamid-ok',
    ]);
    const discards = published.filter(
      (event) => event instanceof InboundMessageDiscardedEvent,
    );
    const received = published.filter(
      (event) => event instanceof InboundMessageReceivedEvent,
    );
    expect(discards).toHaveLength(2);
    expect(discards[0]).toMatchObject({
      messageId: 'wamid-empty',
      type: 'text',
      reason: 'missing-text-body',
    });
    expect(discards[1]).toMatchObject({
      messageId: 'wamid-order',
      type: 'order',
      reason: 'unknown-type',
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ messageId: 'wamid-ok', type: 'text' });
  });

  it('warns and answers empty when the entry list is missing', () => {
    const result = service.parseWebhook({
      object: 'whatsapp_business_account',
    });

    expect(result.messages).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns, omits and publishes per message when the channel id is missing', () => {
    const result = service.parseWebhook(
      webhookWith(valueWith([textMessage()])),
    );

    expect(result.messages).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(published[0]).toMatchObject({
      messageId: 'wamid-1',
      type: 'text',
      reason: 'missing-channel-id',
    });
  });

  it('never throws on a malformed body', () => {
    for (const body of [null, undefined, {}, { object: 'other' }]) {
      expect(service.parseWebhook(body).messages).toEqual([]);
    }
    expect(publish).not.toHaveBeenCalled();
  });
});
