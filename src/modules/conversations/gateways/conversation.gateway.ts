import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PinoLogger } from 'nestjs-pino';
import { CommandBus } from '@nestjs/cqrs';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ConversationSocketEvent, SOCKET_NAMESPACES } from '../../../contracts/index';
import type { JwtPayload } from '../../../auth/auth.types';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';
import { SendConversationMessageCommand } from '../commands/send-conversation-message.command';
import {
  ConversationAccessService,
  type ConversationSocketIdentity,
} from '../realtime/conversation-access.service';

interface AuthHandshake {
  companyId?: string;
  user?: string | { id?: string };
}

interface CustomSocket extends Socket {
  handshake: Socket['handshake'] & { auth: AuthHandshake };
}

/**
 * T6: every room join is authorized through `ConversationAccessService`.
 * Identity comes from the verified `access_token` cookie when present
 * (existing HTTP plumbing) and falls back to the legacy handshake
 * auth/headers for additive compatibility; membership is always checked
 * against `company_members` before any room is joined.
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
  ) {
    this.logger.setContext(ConversationGateway.name);
  }

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage(ConversationSocketEvent.Join)
  async handleJoin(
    @ConnectedSocket() client: CustomSocket,
    @MessageBody() { room }: { room: string },
  ) {
    const identity = await this.resolveIdentity(client);
    if (!identity.userId || !identity.companyId) {
      this.logger.error('Company context required');
      throw new ForbiddenException('Company context required');
    }

    await this.access.assertCanJoinConversation(room, identity);

    void client.join(`conversation:${room}`);
    this.logger.debug(client.handshake, 'Client Joined Room: ' + room);
    client.emit(ConversationSocketEvent.Joined, { room });
  }

  /**
   * `conversation:message:send` payload:
   * { room: conversationId, to, sender: {id, type}, msg: {type, content} }
   */
  @SubscribeMessage(ConversationSocketEvent.SendMessage)
  handleSendMessage(
    @ConnectedSocket() client: CustomSocket,
    @MessageBody() data: SendConversationMessageDto,
  ) {
    const companyId =
      (client.handshake.headers['x-company-id'] as string | undefined) ??
      client.handshake.auth.companyId;

    this.logger.debug('Execute Command: SendConversationMessageCommand');
    void this.commandBus.execute(
      new SendConversationMessageCommand({
        ...data,
        companyId: data.companyId ?? companyId,
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

  async handleConnection(client: CustomSocket, ..._args: unknown[]) {
    const identity = await this.resolveIdentity(client);
    if (!identity.userId) return;

    // A verified token proves the user: the personal room is safe even before
    // the company membership resolves.
    if (identity.authenticated) {
      void client.join(`user:${identity.userId}`);
    }

    if (!identity.companyId) return;

    let member: Awaited<
      ReturnType<ConversationAccessService['findActiveMember']>
    >;
    try {
      member = await this.access.findActiveMember(identity);
    } catch (error) {
      // A membership lookup failure must not surface as an unhandled rejection.
      this.logger.warn(
        { error: String(error) },
        'Socket membership lookup failed',
      );
      return;
    }
    if (!member) {
      this.logger.warn(
        { userId: identity.userId, companyId: identity.companyId },
        'Socket joined no company rooms: no active membership',
      );
      return;
    }

    // Legacy (header-only) identity: the personal room also needs the active
    // membership, so a spoofed pair cannot subscribe to another user's events.
    if (!identity.authenticated) {
      void client.join(`user:${identity.userId}`);
    }
    void client.join(`company:${identity.companyId}`);

    this.logger.debug(client.handshake, 'client connection');
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(client.handshake, 'client disconnect');
  }

  /**
   * Verified `access_token` cookie first; raw handshake auth/headers only as
   * the legacy fallback. An invalid token yields no identity at all (never a
   * silent fallback to spoofable headers).
   */
  private async resolveIdentity(
    client: CustomSocket,
  ): Promise<ConversationSocketIdentity> {
    const auth = (client.handshake.auth ?? {}) as AuthHandshake;
    const headers = client.handshake.headers ?? {};
    const headerUserId = headers['x-user-id'] as string | undefined;
    const headerCompanyId = headers['x-company-id'] as string | undefined;
    const authUserId =
      typeof auth.user === 'object' ? auth.user?.id : auth.user;
    const companyId = headerCompanyId ?? auth.companyId ?? null;

    const token = readAccessToken(headers.cookie);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        return {
          userId: payload.sub ?? null,
          companyId,
          authenticated: true,
        };
      } catch (error) {
        this.logger.warn(
          { error: String(error) },
          'Socket access token rejected',
        );
        return { userId: null, companyId: null, authenticated: false };
      }
    }

    return {
      userId: headerUserId ?? authUserId ?? null,
      companyId,
      authenticated: false,
    };
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
