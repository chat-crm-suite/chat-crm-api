// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { CommandBus } from '@nestjs/cqrs';

import { ConversationSocketEvent } from '@contracts';
import type { JwtPayload } from '@auth/auth.types';
import type { SessionRevocationService } from '@auth/session/session-revocation.service';
import type { SendConversationMessageDto } from '../dto/send-conversation-message.dto';
import { SendConversationMessageCommand } from '../commands/send-conversation-message.command';
import type { ConversationAccessService } from '../realtime/conversation-access.service';
import { ConversationGateway } from './conversation.gateway';

/**
 * Gateway seam: identity comes only from the verified `access_token` cookie,
 * checked once at connect time; the socket joins every company room of the
 * token. Conversation joins and sends are re-checked against the token
 * memberships and the access service, so no socket reaches another company.
 */
describe('ConversationGateway', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const claims: JwtPayload = {
    sub: 'user-1',
    memberships: [
      { cid: 'co-1', mid: 'member-1', role: 'agent' },
      { cid: 'co-2', mid: 'member-2', role: 'admin' },
    ],
    ts: 1,
  };

  const build = () => {
    const access = { assertCanJoinConversation: jest.fn() };
    const jwt = { verifyAsync: jest.fn() };
    const commandBus = { execute: jest.fn() };
    const sessions = { isStale: jest.fn().mockResolvedValue(false) };
    const gateway = new ConversationGateway(
      logger as never,
      commandBus as unknown as CommandBus,
      access as unknown as ConversationAccessService,
      jwt as unknown as JwtService,
      sessions as unknown as SessionRevocationService,
    );

    return { gateway, access, jwt, commandBus, sessions };
  };

  const socket = (
    overrides: {
      headers?: Record<string, string>;
      auth?: Record<string, unknown>;
      user?: JwtPayload;
      /** Conversations granted at join: conversationId -> companyId. */
      joined?: Record<string, string>;
    } = {},
  ) => ({
    handshake: {
      auth: overrides.auth ?? {},
      headers: overrides.headers ?? {},
    },
    data: {
      ...(overrides.user ? { user: overrides.user } : {}),
      ...(overrides.joined ? { conversations: overrides.joined } : {}),
    },
    rooms: new Set(
      Object.keys(overrides.joined ?? {}).map((id) => `conversation:${id}`),
    ),
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeEach(() => jest.clearAllMocks());

  describe('handleConnection', () => {
    it('joins the personal room and every company room of the verified token', async () => {
      const { gateway, jwt } = build();
      jwt.verifyAsync.mockResolvedValue(claims);
      const client = socket({ headers: { cookie: 'access_token=valid-token' } });

      await gateway.handleConnection(client as never);

      expect(jwt.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(client.data).toEqual({ user: claims });
      expect(client.join).toHaveBeenCalledWith([
        'user:user-1',
        'company:co-1',
        'company:co-2',
      ]);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects a socket without a session cookie, ignoring spoofable headers', async () => {
      const { gateway, jwt } = build();
      const client = socket({
        headers: { 'x-user-id': 'user-1', 'x-company-id': 'co-1' },
        auth: { user: { id: 'user-1' }, companyId: 'co-1' },
      });

      await gateway.handleConnection(client as never);

      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket with an invalid token', async () => {
      const { gateway, jwt } = build();
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      const client = socket({ headers: { cookie: 'access_token=forged' } });

      await gateway.handleConnection(client as never);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket whose token memberships are stale', async () => {
      const { gateway, jwt, sessions } = build();
      jwt.verifyAsync.mockResolvedValue(claims);
      sessions.isStale.mockResolvedValue(true);
      const client = socket({ headers: { cookie: 'access_token=old' } });

      await gateway.handleConnection(client as never);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleJoin', () => {
    it('joins the conversation room only after the membership check passes', async () => {
      const { gateway, access } = build();
      access.assertCanJoinConversation.mockResolvedValue({
        room: 'conversation:conv-1',
      });
      const client = socket({ user: claims });

      await gateway.handleJoin(client as never, { room: 'conv-1', companyId: 'co-2' });

      expect(access.assertCanJoinConversation).toHaveBeenCalledWith('conv-1', {
        userId: 'user-1',
        companyId: 'co-2',
        authenticated: true,
      });
      expect(client.join).toHaveBeenCalledWith('conversation:conv-1');
      expect(client.data.conversations).toEqual({ 'conv-1': 'co-2' });
      expect(client.emit).toHaveBeenCalledWith(ConversationSocketEvent.Joined, {
        room: 'conv-1',
      });
    });

    it('defaults to the only company of a single-membership user', async () => {
      const { gateway, access } = build();
      access.assertCanJoinConversation.mockResolvedValue({ room: 'conversation:conv-1' });
      const single = { ...claims, memberships: [claims.memberships[0]] };

      await gateway.handleJoin(socket({ user: single }) as never, { room: 'conv-1' });

      expect(access.assertCanJoinConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ companyId: 'co-1' }),
      );
    });

    it('refuses a company outside the token memberships without querying access', async () => {
      const { gateway, access } = build();
      const client = socket({ user: claims });

      await expect(
        gateway.handleJoin(client as never, { room: 'conv-1', companyId: 'co-9' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('requires a company when the user belongs to several', async () => {
      const { gateway } = build();

      await expect(
        gateway.handleJoin(socket({ user: claims }) as never, { room: 'conv-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never joins the room when the access service denies it', async () => {
      const { gateway, access } = build();
      access.assertCanJoinConversation.mockRejectedValue(
        new ForbiddenException('Conversation access denied'),
      );
      const client = socket({ user: claims });

      await expect(
        gateway.handleJoin(client as never, { room: 'conv-other', companyId: 'co-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('refuses a socket that never authenticated', async () => {
      const { gateway, access } = build();

      await expect(
        gateway.handleJoin(socket() as never, { room: 'conv-1', companyId: 'co-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
    });
  });

  describe('handleSendMessage', () => {
    const payload = (overrides: Partial<SendConversationMessageDto> = {}) =>
      ({
        room: 'conv-1',
        companyId: 'co-1',
        to: '51999999999',
        sender: { id: 'someone-else', type: 'customer' },
        msg: { type: 'text', content: { body: 'Hola' } },
        ...overrides,
      }) as SendConversationMessageDto;

    const joined = () => socket({ user: claims, joined: { 'conv-1': 'co-1' } });

    it('sends as the socket own member without re-querying access', async () => {
      const { gateway, access, commandBus } = build();

      await gateway.handleSendMessage(joined() as never, payload());

      expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
      const [[command]] = commandBus.execute.mock.calls as [[SendConversationMessageCommand]];
      expect(command).toBeInstanceOf(SendConversationMessageCommand);
      expect(command.data).toMatchObject({
        room: 'conv-1',
        companyId: 'co-1',
        sender: { id: 'member-1', type: 'member' },
      });
    });

    it('uses the company granted at join when the payload omits it', async () => {
      const { gateway, commandBus } = build();

      await gateway.handleSendMessage(
        joined() as never,
        payload({ companyId: undefined }),
      );

      const [[command]] = commandBus.execute.mock.calls as [[SendConversationMessageCommand]];
      expect(command.data).toMatchObject({ companyId: 'co-1' });
    });

    it('refuses a conversation the socket never joined', async () => {
      const { gateway, commandBus } = build();

      await expect(
        gateway.handleSendMessage(socket({ user: claims }) as never, payload()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(commandBus.execute).not.toHaveBeenCalled();
    });

    it('refuses once the socket left the room (access revoked)', async () => {
      const { gateway, commandBus } = build();
      const client = joined();
      client.rooms.clear();

      await expect(
        gateway.handleSendMessage(client as never, payload()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(commandBus.execute).not.toHaveBeenCalled();
    });

    it('refuses a payload naming another company than the grant', async () => {
      const { gateway, commandBus } = build();

      await expect(
        gateway.handleSendMessage(joined() as never, payload({ companyId: 'co-2' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(commandBus.execute).not.toHaveBeenCalled();
    });
  });

  describe('revokeConversationAccess', () => {
    const remote = (memberships: JwtPayload['memberships']) => ({
      data: { user: { ...claims, memberships } },
      leave: jest.fn(),
    });

    it('removes agents other than the new owner and keeps admins', async () => {
      const { gateway } = build();
      const owner = remote([{ cid: 'co-1', mid: 'member-1', role: 'agent' }]);
      const otherAgent = remote([{ cid: 'co-1', mid: 'member-9', role: 'agent' }]);
      const supervisor = remote([{ cid: 'co-1', mid: 'member-5', role: 'supervisor' }]);
      const fetchSockets = jest
        .fn()
        .mockResolvedValue([owner, otherAgent, supervisor]);
      const inRoom = jest.fn().mockReturnValue({ fetchSockets });
      gateway.server = { in: inRoom } as never;

      await gateway.revokeConversationAccess('conv-1', 'co-1', 'member-1');

      expect(inRoom).toHaveBeenCalledWith('conversation:conv-1');
      expect(owner.leave).not.toHaveBeenCalled();
      expect(supervisor.leave).not.toHaveBeenCalled();
      expect(otherAgent.leave).toHaveBeenCalledWith('conversation:conv-1');
    });
  });

  it('drops every socket of a revoked user through the personal room', () => {
    const { gateway } = build();
    const disconnectSockets = jest.fn();
    const inRoom = jest.fn().mockReturnValue({ disconnectSockets });
    gateway.server = { in: inRoom } as never;

    gateway.disconnectUser('user-1');

    expect(inRoom).toHaveBeenCalledWith('user:user-1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });
});
