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

import { ConversationSocketEvent } from '../../../contracts/index';
import { SendConversationMessageDto } from '../dto/send-conversation-message.dto';
import { SendConversationMessageCommand } from '../commands/send-conversation-message.command';

interface AuthHandshake {
  companyId?: string;
  user?: string | { id?: string };
}

interface CustomSocket extends Socket {
  handshake: Socket['handshake'] & { auth: AuthHandshake };
}

@WebSocketGateway({
  namespace: 'conversation',
  cors: { origin: '*', credentials: true },
})
export class ConversationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly logger: PinoLogger,
    private readonly commandBus: CommandBus,
  ) {
    this.logger.setContext(ConversationGateway.name);
  }

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage(ConversationSocketEvent.Join)
  handleJoin(
    @ConnectedSocket() client: CustomSocket,
    @MessageBody() { room }: { room: string },
  ) {
    const companyId =
      client.handshake.headers['x-company-id'] ?? client.handshake.auth.companyId;

    if (!companyId) {
      this.logger.error('Company context required');
      throw new ForbiddenException('Company context required');
    }

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

  handleConnection(client: CustomSocket, ..._args: unknown[]) {
    const auth = client.handshake.auth as AuthHandshake & {
      user?: { id?: string };
    };
    const headerUserId = client.handshake.headers['x-user-id'] as
      | string
      | undefined;
    const userId =
      (typeof auth?.user === 'object' ? auth.user?.id : auth?.user) ??
      headerUserId;
    const headerCompanyId = client.handshake.headers['x-company-id'] as
      | string
      | undefined;
    const companyId = headerCompanyId ?? auth?.companyId;

    // Rooms personales/empresa: el front no necesita join manual; el backend lo
    // hace al conectar para poder emitir notificaciones y eventos dirigidos.
    // (La validación por JWT de estos headers llega en la fase realtime.)
    if (userId) void client.join(`user:${userId}`);
    if (companyId) void client.join(`company:${companyId}`);

    this.logger.debug(client.handshake, 'client connection');
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(client.handshake, 'client disconnect');
  }
}
