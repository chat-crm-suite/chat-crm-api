// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HttpStatus } from '@nestjs/common';
import type { WhatsappNotification } from '@daweto/whatsapp-api-types';

import { ReceiveWhatsAppMessageCommand } from '../commands/receive-whatsapp-message.command';
import { FailWhatsAppMessageCommand } from '../../../modules/conversations/commands/fail-whatsapp-message.command';
import { UpdateMessageStatusCommand } from '../../../modules/conversations/commands/update-message-status.command';
import { WebhookController } from './webhook.controller';

/**
 * T1 intake, observed at the webhook HTTP seam:
 * - valid signature + new `wamid` → 200, one durable event, work dispatched
 * - same `wamid` again → 200, nothing dispatched
 * - invalid signature (or no secret) → 403, nothing stored, nothing queued
 *
 * Signature literals below are independent (generated with openssl, pinned
 * by `whatsapp-signature.spec.ts`); row-level durability is covered by
 * `whatsapp-intake.service.spec.ts`.
 */
describe('WebhookController (T1 durable intake)', () => {
  const TEXT_PAYLOAD =
    '{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"phone-1"},"contacts":[{"wa_id":"15551234567","profile":{"name":"Alice"}}],"messages":[{"id":"wamid-test-1","from":"15551234567","timestamp":"1760000000","type":"text","text":{"body":"hola"}}]}}]}]}';
  const TEXT_SIGNATURE =
    'sha256=5ba695381fa6420f8a96c4e3f3b9e64af7ef03bb29de94093505e37f3c42be7b';

  const STATUS_PAYLOAD =
    '{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"phone-1"},"statuses":[{"id":"wamid-out-1","status":"delivered","timestamp":"1760000001","recipient_id":"15551234567"}]}}]}]}';
  const STATUS_SIGNATURE =
    'sha256=6f09d7513d630d2bf32d834fa29a1e87727ff696c0785394d1a7040a8436323e';

  const FAILED_STATUS_PAYLOAD =
    '{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"phone-1"},"statuses":[{"id":"wamid-out-1","status":"failed","timestamp":"1760000002","recipient_id":"15551234567","errors":[{"code":131047,"title":"Re-engagement message","message":"Message failed to send because more than 24 hours have passed since the customer last replied","error_data":{"details":"Message failed to send"}}]}]}}]}]}';
  const FAILED_STATUS_SIGNATURE =
    'sha256=81ab5fb413a8d464c8b79b4e58f369f055d331a81ff0bab1a360f396a8a413ac';

  let service: { verifyToken: jest.Mock };
  let commandExecute: jest.Mock<Promise<unknown>, [unknown]>;
  let configGet: jest.Mock;
  let persistIfNew: jest.Mock;
  let markReplayed: jest.Mock;
  let logger: {
    debug: jest.Mock;
    error: jest.Mock;
    warn: jest.Mock;
    setContext: jest.Mock;
  };
  let controller: WebhookController;

  const textPayload = () => JSON.parse(TEXT_PAYLOAD) as WhatsappNotification;
  const statusPayload = () =>
    JSON.parse(STATUS_PAYLOAD) as WhatsappNotification;
  const failedStatusPayload = () =>
    JSON.parse(FAILED_STATUS_PAYLOAD) as WhatsappNotification;
  const statusCommand = () =>
    commandExecute.mock.calls
      .map(([command]) => command)
      .find(
        (command): command is UpdateMessageStatusCommand =>
          command instanceof UpdateMessageStatusCommand,
      );
  const failCommand = () =>
    commandExecute.mock.calls
      .map(([command]) => command)
      .find(
        (command): command is FailWhatsAppMessageCommand =>
          command instanceof FailWhatsAppMessageCommand,
      );
  const request = (rawBody: string, signature: string | undefined) => ({
    headers: { 'x-hub-signature-256': signature },
    rawBody: Buffer.from(rawBody, 'utf8'),
  });
  const response = () => ({ sendStatus: jest.fn() });

  beforeEach(() => {
    service = { verifyToken: jest.fn() };
    commandExecute = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue(undefined);
    configGet = jest.fn().mockReturnValue('test-app-secret');
    persistIfNew = jest.fn().mockResolvedValue('stored');
    markReplayed = jest.fn().mockResolvedValue(undefined);
    logger = {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };

    controller = new WebhookController(
      service as never,
      { execute: commandExecute } as never,
      logger as never,
      { get: configGet } as never,
      { persistIfNew, markReplayed } as never,
    );
  });

  it('stores a new wamid, then answers 200 and dispatches it', async () => {
    const res = response();

    await controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, TEXT_SIGNATURE) as never,
      res as never,
    );

    expect(persistIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ wamid: 'wamid-test-1' }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(commandExecute).toHaveBeenCalledWith(
      expect.any(ReceiveWhatsAppMessageCommand),
    );
    const dispatched = commandExecute.mock
      .calls[0][0] as ReceiveWhatsAppMessageCommand;
    expect(dispatched.message.context.messageId).toBe('wamid-test-1');
  });

  it('answers 200 only after the event is durable', async () => {
    let resolvePersist!: (outcome: 'stored' | 'duplicate') => void;
    persistIfNew.mockReturnValue(
      new Promise((resolve) => {
        resolvePersist = resolve;
      }),
    );
    const res = response();

    const pending = controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, TEXT_SIGNATURE) as never,
      res as never,
    );
    await Promise.resolve();
    expect(res.sendStatus).not.toHaveBeenCalled();

    resolvePersist('stored');
    await pending;
    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('answers 200 for a retried wamid without dispatching work', async () => {
    persistIfNew.mockResolvedValue('duplicate');
    const res = response();

    await controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, TEXT_SIGNATURE) as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(commandExecute).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 403, storing and queueing nothing', async () => {
    const res = response();

    await controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, 'sha256=deadbeef') as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(persistIfNew).not.toHaveBeenCalled();
    expect(commandExecute).not.toHaveBeenCalled();
  });

  it('rejects with 403 when no app secret is configured', async () => {
    configGet.mockReturnValue(undefined);
    const res = response();

    await controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, TEXT_SIGNATURE) as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(persistIfNew).not.toHaveBeenCalled();
    expect(commandExecute).not.toHaveBeenCalled();
  });

  it('still answers 200 when post-persist processing fails', async () => {
    commandExecute.mockRejectedValue(new Error('broker down'));
    const res = response();

    await controller.receiveMessage(
      textPayload(),
      request(TEXT_PAYLOAD, TEXT_SIGNATURE) as never,
      res as never,
    );

    expect(persistIfNew).toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('persists a status-only callback before answering 200', async () => {
    const res = response();

    await controller.receiveMessage(
      statusPayload(),
      request(STATUS_PAYLOAD, STATUS_SIGNATURE) as never,
      res as never,
    );

    expect(persistIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        wamid: 'wamid-out-1',
        kind: 'status:delivered',
        messageType: 'delivered',
      }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('answers 200 only after the status tick is durable', async () => {
    let resolvePersist!: (outcome: 'stored' | 'duplicate') => void;
    persistIfNew.mockReturnValue(
      new Promise((resolve) => {
        resolvePersist = resolve;
      }),
    );
    const res = response();

    const pending = controller.receiveMessage(
      statusPayload(),
      request(STATUS_PAYLOAD, STATUS_SIGNATURE) as never,
      res as never,
    );
    await Promise.resolve();
    expect(res.sendStatus).not.toHaveBeenCalled();

    resolvePersist('stored');
    await pending;
    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('does not dispatch a status tick already stored by an earlier post', async () => {
    persistIfNew.mockResolvedValue('duplicate');
    const res = response();

    await controller.receiveMessage(
      statusPayload(),
      request(STATUS_PAYLOAD, STATUS_SIGNATURE) as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(statusCommand()).toBeUndefined();
  });

  it('consumes the durable status tick once it is applied', async () => {
    const res = response();

    await controller.receiveMessage(
      statusPayload(),
      request(STATUS_PAYLOAD, STATUS_SIGNATURE) as never,
      res as never,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(markReplayed).toHaveBeenCalledWith(
      'wamid-out-1',
      'status:delivered',
    );
  });

  it('dispatches a delivered state keyed by wamid with Meta time', async () => {
    const res = response();

    await controller.receiveMessage(
      statusPayload(),
      request(STATUS_PAYLOAD, STATUS_SIGNATURE) as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(statusCommand()).toMatchObject({
      wamid: 'wamid-out-1',
      status: 'delivered',
    });
    expect(statusCommand()?.occurredAt).toEqual(new Date(1_760_000_001_000));
  });

  it('dispatches a failed state with its error code and message', async () => {
    const res = response();

    await controller.receiveMessage(
      failedStatusPayload(),
      request(FAILED_STATUS_PAYLOAD, FAILED_STATUS_SIGNATURE) as never,
      res as never,
    );

    expect(res.sendStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(statusCommand()).toMatchObject({
      wamid: 'wamid-out-1',
      status: 'failed',
      error: {
        code: '131047',
        message:
          'Message failed to send because more than 24 hours have passed since the customer last replied',
      },
    });
    expect(statusCommand()?.occurredAt).toEqual(new Date(1_760_000_002_000));
  });

  it('flags a raw 131047 status error for the template action (#9)', async () => {
    const res = response();

    await controller.receiveMessage(
      failedStatusPayload(),
      request(FAILED_STATUS_PAYLOAD, FAILED_STATUS_SIGNATURE) as never,
      res as never,
    );

    const command = failCommand();
    expect(command).toBeInstanceOf(FailWhatsAppMessageCommand);
    expect(command?.recipientId).toBe('15551234567');
    expect(command?.err).toMatchObject({
      code: 131047,
      hasAction: true,
      to: '15551234567',
    });
  });
});
