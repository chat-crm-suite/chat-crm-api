// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Logger, type INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { io, type Socket } from 'socket.io-client';

import { ConversationSocketEvent, SOCKET_NAMESPACES } from '@contracts';
import type { JwtPayload } from '@auth/auth.types';
import { SessionRevocationService } from '@auth/session/session-revocation.service';
import { ConversationAccessService } from '../realtime/conversation-access.service';
import { ConversationGateway } from './conversation.gateway';

const claims: JwtPayload = {
  sub: 'user-1',
  memberships: [{ cid: 'co-1', mid: 'member-1', role: 'agent' }],
  ts: 1,
};

const validSend = {
  room: 'conv-1',
  companyId: 'co-1',
  clientMessageId: 'client-1',
  to: '51999000111',
  sender: { id: 'member-1', type: 'member' },
  msg: { type: 'text', content: { body: 'Hola' } },
};

/**
 * Real socket.io round trip (no database): the send is acknowledged once
 * queued, and validation or access failures come back through the same ack
 * instead of a fire-and-forget `exception` event.
 */
describe('ConversationGateway send acknowledgement', () => {
  let app: INestApplication;
  let url: string;
  let client: Socket;
  const commandBus = { execute: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConversationGateway,
        {
          provide: PinoLogger,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            setContext: jest.fn(),
          },
        },
        { provide: CommandBus, useValue: commandBus },
        {
          provide: ConversationAccessService,
          useValue: { assertCanJoinConversation: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn().mockResolvedValue(claims) },
        },
        {
          provide: SessionRevocationService,
          useValue: { isStale: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    url = `${await app.getUrl()}/${SOCKET_NAMESPACES.conversation}`.replace(
      '[::1]',
      'localhost',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    commandBus.execute.mockClear();
    client = io(url, {
      transports: ['websocket'],
      extraHeaders: { cookie: 'access_token=valid' },
      forceNew: true,
    });
    await new Promise<void>((resolve) => client.on('connect', resolve));
  });

  afterEach(() => client.disconnect());

  const join = () =>
    new Promise<void>((resolve) => {
      client.once(ConversationSocketEvent.Joined, () => resolve());
      client.emit(ConversationSocketEvent.Join, {
        room: 'conv-1',
        companyId: 'co-1',
      });
    });

  const send = (payload: unknown) =>
    client.timeout(5000).emitWithAck(ConversationSocketEvent.SendMessage, payload);

  it('acknowledges a queued send', async () => {
    await join();

    await expect(send(validSend)).resolves.toEqual({ ok: true });
    expect(commandBus.execute).toHaveBeenCalledTimes(1);
  });

  it('acknowledges an invalid payload as a validation failure', async () => {
    await join();

    await expect(send({ room: 'conv-1' })).resolves.toMatchObject({
      ok: false,
      code: 'validation',
    });
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('acknowledges a send without join as forbidden', async () => {
    await expect(send(validSend)).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'Join the conversation before sending',
    });
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('hides internal errors behind a generic message', async () => {
    await join();
    commandBus.execute.mockRejectedValueOnce(new Error('redis is down'));
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(send(validSend)).resolves.toEqual({
      ok: false,
      code: 'internal',
      message: 'Unexpected error',
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
