// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpStatus } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { WebhookController } from '../controllers/webhook.controller';
import { mapInboundWebhookToMessages } from '../mappers/inbound-message-parsers.registry';
import { WhatsAppInboundReplayService } from './whatsapp-inbound-replay.service';

/**
 * Ticket #22 (live/replay parity): the same first-contact message through
 * both paths resolves the same customer identity and display name. The live
 * path reads the sender name from the webhook contact snapshot; the replay
 * path rehydrates it from the durable row persisted at intake.
 *
 * Seam under test: controller boundary (live) plus replay service seam
 * (replay), both with mocked collaborators. Behavior is observed through the
 * dispatched `ReceiveWhatsAppMessageCommand` on each side — the exact input
 * the customer-identity resolution (`findOrCreateIncoming`) consumes — so
 * equal commands mean an equal customer outcome.
 */
describe('Inbound live/replay parity (ticket #22)', () => {
  const TEXT_PAYLOAD =
    '{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"phone-1"},"contacts":[{"wa_id":"15551234567","profile":{"name":"Alice"}}],"messages":[{"id":"wamid-parity-1","from":"15551234567","timestamp":"1760000000","type":"text","text":{"body":"hola"}}]}}]}]}';
  const TEXT_SIGNATURE =
    'sha256=98483dc5d3488b3aafdf415e7f74ea9b14a4f5b5a68e8fa6fda9dd3da1875215';

  const nullLogger = () => ({
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  });

  const driveLive = async () => {
    const liveCommands: unknown[] = [];
    const persisted: Record<string, unknown>[] = [];
    const controller = new WebhookController(
      {
        verifyToken: jest.fn(),
        getWebhookAppSecrets: jest.fn().mockResolvedValue([]),
      } as never,
      {
        execute: jest.fn((command: unknown) => {
          liveCommands.push(command);
          return Promise.resolve(undefined);
        }),
      } as never,
      nullLogger() as never,
      { get: jest.fn().mockReturnValue('test-app-secret') } as never,
      {
        persistIfNew: jest.fn((input: Record<string, unknown>) => {
          persisted.push(input);
          return Promise.resolve('stored' as const);
        }),
        markReplayed: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        parseWebhook: jest.fn((body: unknown) =>
          mapInboundWebhookToMessages(body),
        ),
      } as never,
    );

    const res = { sendStatus: jest.fn() };
    await controller.receiveMessage(
      JSON.parse(TEXT_PAYLOAD) as WhatsappNotification,
      {
        headers: { 'x-hub-signature-256': TEXT_SIGNATURE },
        rawBody: Buffer.from(TEXT_PAYLOAD, 'utf8'),
      } as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    const command = liveCommands.find(
      (c): c is ReceiveWhatsAppMessageCommand =>
        c instanceof ReceiveWhatsAppMessageCommand,
    );
    expect(command).toBeInstanceOf(ReceiveWhatsAppMessageCommand);
    return { command: command!, persisted: persisted[0] };
  };

  const driveReplay = async (stored: Record<string, unknown>) => {
    const replayCommands: unknown[] = [];
    const service = new WhatsAppInboundReplayService(
      {
        listPending: jest.fn().mockResolvedValue([stored]),
        markReplayed: jest.fn().mockResolvedValue(undefined),
      } as never,
      { findByExternalId: jest.fn().mockResolvedValue(null) } as never,
      {
        execute: jest.fn((command: unknown) => {
          replayCommands.push(command);
          return Promise.resolve(undefined);
        }),
      } as never,
      nullLogger() as never,
    );

    await expect(service.replayPending()).resolves.toBe(1);
    const command = replayCommands.find(
      (c): c is ReceiveWhatsAppMessageCommand =>
        c instanceof ReceiveWhatsAppMessageCommand,
    );
    expect(command).toBeInstanceOf(ReceiveWhatsAppMessageCommand);
    return command!;
  };

  it('resolves the same customer identity and display name on both paths', async () => {
    const live = await driveLive();

    // The intake row is the only bridge between paths: crash after the 200
    // leaves exactly this behind for the boot replay.
    expect(live.persisted).toMatchObject({
      wamid: 'wamid-parity-1',
      senderName: 'Alice',
    });
    const replayed = await driveReplay({
      wamid: live.persisted['wamid'],
      kind: 'message',
      phoneNumberId: live.persisted['phoneNumberId'],
      messageType: live.persisted['messageType'],
      senderName: live.persisted['senderName'],
      status: 'pending',
      payload: live.persisted['payload'],
    });

    // Same inputs to the customer-identity resolution: same customer, same
    // display name — including first contact.
    expect(replayed.message.context).toEqual(live.command.message.context);
    expect(replayed.message.context).toMatchObject({
      messageId: 'wamid-parity-1',
      from: '15551234567',
      phoneNumberId: 'phone-1',
      senderName: 'Alice',
    });
    expect(replayed.message.content).toEqual(live.command.message.content);
  });

  it('omits the same message on both paths when the channel id is missing', async () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111' },
                messages: [
                  {
                    id: 'wamid-no-channel-1',
                    from: '15551234567',
                    timestamp: '1760000000',
                    type: 'text',
                    text: { body: 'hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', 'test-app-secret')
      .update(raw)
      .digest('hex')}`;

    // Live: the border discards the message for lack of a channel id, so
    // nothing is ever dispatched.
    const liveCommands: unknown[] = [];
    const live = new WebhookController(
      {
        verifyToken: jest.fn(),
        getWebhookAppSecrets: jest.fn().mockResolvedValue([]),
      } as never,
      {
        execute: jest.fn((command: unknown) => {
          liveCommands.push(command);
          return Promise.resolve(undefined);
        }),
      } as never,
      nullLogger() as never,
      { get: jest.fn().mockReturnValue('test-app-secret') } as never,
      {
        persistIfNew: jest.fn().mockResolvedValue('stored' as const),
        markReplayed: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        parseWebhook: jest.fn((body: unknown) =>
          mapInboundWebhookToMessages(body),
        ),
      } as never,
    );

    const res = { sendStatus: jest.fn() };
    await live.receiveMessage(
      JSON.parse(raw) as WhatsappNotification,
      {
        headers: { 'x-hub-signature-256': signature },
        rawBody: Buffer.from(raw, 'utf8'),
      } as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(
      liveCommands.filter((c) => c instanceof ReceiveWhatsAppMessageCommand),
    ).toHaveLength(0);

    // Replay: the stored row carries no channel id, so the rehydration omits it
    // exactly like the live path — no ghost command the live border would drop.
    const replayCommands: unknown[] = [];
    const service = new WhatsAppInboundReplayService(
      {
        listPending: jest.fn().mockResolvedValue([
          {
            wamid: 'wamid-no-channel-1',
            kind: 'message',
            phoneNumberId: undefined,
            messageType: 'text',
            status: 'pending',
            payload: {
              id: 'wamid-no-channel-1',
              from: '15551234567',
              timestamp: '1760000000',
              type: 'text',
              text: { body: 'hola' },
            },
          },
        ]),
        markReplayed: jest.fn().mockResolvedValue(undefined),
      } as never,
      { findByExternalId: jest.fn().mockResolvedValue(null) } as never,
      {
        execute: jest.fn((command: unknown) => {
          replayCommands.push(command);
          return Promise.resolve(undefined);
        }),
      } as never,
      nullLogger() as never,
    );

    await expect(service.replayPending()).resolves.toBe(0);
    expect(
      replayCommands.filter((c) => c instanceof ReceiveWhatsAppMessageCommand),
    ).toHaveLength(0);
  });
});
