// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { PinoLogger } from 'nestjs-pino';
import { CommandBus } from '@nestjs/cqrs';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ConversationSocketEvent, SOCKET_NAMESPACES } from '@contracts';
import type { JwtPayload } from '@auth/auth.types';
import { findMembership } from '@auth/membership';
import { SessionRevocationService } from '@auth/session/session-revocation.service';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';
import { SendConversationMessageCommand } from '../commands/send-conversation-message.command';
import { ConversationAccessService } from '../realtime/conversation-access.service';

/** Socket data set once at connect time from the verified cookie. */
export interface ConversationSocketData {
  user?: JwtPayload;
}

export type ConversationSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ConversationSocketData
>;

/** Room every socket of one user joins (targeted events, revocation kicks). */
export const userRoom = (userId: string) => `user:${userId}`;
/** Room for company-wide fan-out. */
export const companyRoom = (companyId: string) => `company:${companyId}`;

/**
 * Identity comes only from the verified `access_token` cookie, checked once
 * in the handshake. The socket then joins the rooms of every company in the
 * token, so switching the active company in the client needs no reconnect:
 * events carry their `companyId` and the client routes them. Company-scoped
 * actions are re-checked against the token memberships, and conversation
 * joins go through `ConversationAccessService` (role rules).
 */
@WebSocketGateway({
  namespace: SOCKET_NAMESPACES.conversation,
  cors: { origin: '*', credentials: true },
})
export class ConversationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly logger: PinoLogger,
    private readonly commandBus: CommandBus,
    private readonly access: ConversationAccessService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionRevocationService,
  ) {
    this.logger.setContext(ConversationGateway.name);
  }

  @WebSocketServer()
  server!: Server;

  /**
   * `{ room: conversationId, companyId }`: the company must be one of the
   * socket's memberships; the access service then checks that the
   * conversation belongs to it and that the role may see it.
   */
  @SubscribeMessage(ConversationSocketEvent.Join)
  async handleJoin(
    @ConnectedSocket() client: ConversationSocket,
    @MessageBody() { room, companyId }: { room: string; companyId?: string },
  ) {
    const user = this.requireUser(client);
    const membership = this.resolveMembership(user, companyId);

    await this.access.assertCanJoinConversation(room, {
      userId: user.sub,
      companyId: membership.cid,
      authenticated: true,
    });

    void client.join(`conversation:${room}`);
    this.logger.debug({ room }, 'Client joined room');
    client.emit(ConversationSocketEvent.Joined, { room });
  }

  /**
   * `conversation:message:send` payload:
   * { room: conversationId, companyId, to, msg: {type, content} }.
   * The sender is always the socket's own member in that company (a
   * client-supplied sender is ignored), and the conversation must be one the
   * member may access.
   */
  @SubscribeMessage(ConversationSocketEvent.SendMessage)
  async handleSendMessage(
    @ConnectedSocket() client: ConversationSocket,
    @MessageBody() data: SendConversationMessageDto,
  ) {
    const user = this.requireUser(client);
    const membership = this.resolveMembership(user, data.companyId);

    await this.access.assertCanJoinConversation(data.room, {
      userId: user.sub,
      companyId: membership.cid,
      authenticated: true,
    });

    this.logger.debug('Execute Command: SendConversationMessageCommand');
    void this.commandBus.execute(
      new SendConversationMessageCommand({
        ...data,
        companyId: membership.cid,
        sender: { id: membership.mid, type: 'member' },
      }),
    );
  }

  async hasSockets(roomName: string): Promise<boolean> {
    const sockets = await this.server.in(roomName)?.fetchSockets();
    this.logger.debug(
      sockets.flatMap((socket) => socket.id),
      'Sockets connected',
    );
    return sockets !== undefined && sockets.length > 0;
  }

  /** Drops every live socket of the user (memberships changed). */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  async handleConnection(client: ConversationSocket, ..._args: unknown[]) {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    void client.join([
      userRoom(user.sub),
      ...user.memberships.map((membership) => companyRoom(membership.cid)),
    ]);

    this.logger.debug(
      { userId: user.sub, companies: user.memberships.length },
      'client connection',
    );
  }

  handleDisconnect(client: ConversationSocket) {
    this.logger.debug({ userId: client.data.user?.sub }, 'client disconnect');
  }

  /**
   * Verified, non-stale `access_token` cookie or nothing: there is no
   * fallback to spoofable handshake headers.
   */
  private async authenticate(client: Socket): Promise<JwtPayload | null> {
    const token = readAccessToken(client.handshake.headers?.cookie);
    if (!token) return null;

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (await this.sessions.isStale(payload)) {
        this.logger.debug({ userId: payload.sub }, 'Socket token is stale');
        return null;
      }
      return payload;
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Socket access token rejected');
      return null;
    }
  }

  private requireUser(client: ConversationSocket): JwtPayload {
    const user = client.data.user;
    if (!user) throw new ForbiddenException('Session required');

    return user;
  }

  /**
   * The company a socket action targets: the one given, or the only one the
   * user has. It must be one of the token's memberships.
   */
  private resolveMembership(user: JwtPayload, companyId: string | undefined) {
    const target =
      companyId ?? (user.memberships.length === 1 ? user.memberships[0].cid : undefined);
    const membership = findMembership(user, target);
    if (!membership) {
      throw new ForbiddenException('Company context required');
    }

    return membership;
  }
}

/** Reads `access_token` from a raw Cookie header (WS has no cookie-parser). */
function readAccessToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    if (name !== 'access_token') continue;

    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return null;
}
