import { ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { CommandBus } from '@nestjs/cqrs';

import { ConversationSocketEvent } from '../../../contracts/index';
import type { ConversationAccessService } from '../realtime/conversation-access.service';
import { ConversationGateway } from './conversation.gateway';

/**
 * T6 gateway seam: joining a conversation room goes through the membership
 * check (single access path) and connect-time rooms are only joined with a
 * verified identity, so no socket ends up in another company's rooms.
 */
describe('ConversationGateway (T6)', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    setContext: jest.fn(),
  };

  const build = () => {
    const access = {
      assertCanJoinConversation: jest.fn(),
      findActiveMember: jest.fn(),
    };
    const jwt = { verifyAsync: jest.fn() };
    const gateway = new ConversationGateway(
      logger as never,
      {} as unknown as CommandBus,
      access as unknown as ConversationAccessService,
      jwt as unknown as JwtService,
    );

    return { gateway, access, jwt };
  };

  const socket = (
    overrides: {
      auth?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) => ({
    handshake: {
      auth: overrides.auth ?? {
        user: { id: 'user-1' },
        companyId: 'co-1',
      },
      headers: overrides.headers ?? {},
    },
    join: jest.fn(),
    emit: jest.fn(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('joins the conversation room only after the membership check passes', async () => {
    const { gateway, access } = build();
    access.assertCanJoinConversation.mockResolvedValue({
      room: 'conversation:conv-1',
    });
    const client = socket();

    await gateway.handleJoin(client as never, { room: 'conv-1' });

    expect(access.assertCanJoinConversation).toHaveBeenCalledWith('conv-1', {
      userId: 'user-1',
      companyId: 'co-1',
      authenticated: false,
    });
    expect(client.join).toHaveBeenCalledWith('conversation:conv-1');
    expect(client.emit).toHaveBeenCalledWith(
      ConversationSocketEvent.Joined,
      { room: 'conv-1' },
    );
  });

  it('does not join nor acknowledge when the membership check denies', async () => {
    const { gateway, access } = build();
    access.assertCanJoinConversation.mockRejectedValue(
      new ForbiddenException('Conversation access denied'),
    );
    const client = socket();

    await expect(
      gateway.handleJoin(client as never, { room: 'conv-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('uses the verified JWT cookie as the user identity', async () => {
    const { gateway, access, jwt } = build();
    jwt.verifyAsync.mockResolvedValue({ sub: 'jwt-user', company: 'x' });
    access.assertCanJoinConversation.mockResolvedValue({
      room: 'conversation:conv-1',
    });
    const client = socket({ headers: { cookie: 'access_token=token-1' } });

    await gateway.handleJoin(client as never, { room: 'conv-1' });

    expect(jwt.verifyAsync).toHaveBeenCalledWith('token-1');
    expect(access.assertCanJoinConversation).toHaveBeenCalledWith('conv-1', {
      userId: 'jwt-user',
      companyId: 'co-1',
      authenticated: true,
    });
  });

  it('denies join for an invalid token instead of trusting raw headers', async () => {
    const { gateway, access, jwt } = build();
    jwt.verifyAsync.mockRejectedValue(new Error('expired'));
    const client = socket({
      headers: { cookie: 'access_token=expired-token' },
    });

    await expect(
      gateway.handleJoin(client as never, { room: 'conv-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(access.assertCanJoinConversation).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('joins user and company rooms only for an active member of the claimed company', async () => {
    const { gateway, access } = build();
    access.findActiveMember.mockResolvedValue({ id: 'member-1' });
    const client = socket();

    await gateway.handleConnection(client as never);

    expect(access.findActiveMember).toHaveBeenCalledWith({
      userId: 'user-1',
      companyId: 'co-1',
      authenticated: false,
    });
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.join).toHaveBeenCalledWith('company:co-1');
  });

  it('never joins company rooms when the membership is not active', async () => {
    const { gateway, access } = build();
    access.findActiveMember.mockResolvedValue(null);
    const client = socket();

    await gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalledWith('company:co-1');
    expect(client.join).not.toHaveBeenCalledWith('user:user-1');
  });

  it('keeps the personal room of a verified user even without company membership', async () => {
    const { gateway, access, jwt } = build();
    jwt.verifyAsync.mockResolvedValue({ sub: 'jwt-user', company: 'x' });
    access.findActiveMember.mockResolvedValue(null);
    const client = socket({ headers: { cookie: 'access_token=token-1' } });

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith('user:jwt-user');
    expect(client.join).not.toHaveBeenCalledWith('company:co-1');
  });

  it('keeps the connection alive when the membership lookup fails', async () => {
    const { gateway, access, jwt } = build();
    jwt.verifyAsync.mockResolvedValue({ sub: 'jwt-user', company: 'x' });
    access.findActiveMember.mockRejectedValue(new Error('db down'));
    const client = socket({ headers: { cookie: 'access_token=token-1' } });

    await expect(
      gateway.handleConnection(client as never),
    ).resolves.toBeUndefined();

    expect(client.join).toHaveBeenCalledWith('user:jwt-user');
    expect(client.join).not.toHaveBeenCalledWith('company:co-1');
  });
});
