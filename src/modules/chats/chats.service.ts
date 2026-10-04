import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';
import { ChatDto, UpdateChatDto } from './dto/chat.dto';
import { Chat } from './entities/index';
import { ChatStatus } from './chat.enum';
import { ChatRepository } from './chat.repository';
import { ChatAssignmentService } from './assignment/chat-assignment.service';
import { ChatAssignmentNotifier } from './assignment/chat-assignment.notifier';
import { AssignmentOutcome } from './assignment/assignment.types';
import { ClsService } from 'nestjs-cls';
import { Message } from '../../entities/index';
import { MessageSenderType } from '../message/message.enum';
import { ChatMessageContent } from './chat.types';
import { getMessageStrategy } from '../message/strategies/strategy.registry';
import { MessageType } from '../message/domain/message.types';

@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(Chat) private readonly chatRepo: Repository<Chat>,
    private readonly dataSource: DataSource,
    private readonly repo: ChatRepository,
    private readonly assignment: ChatAssignmentService,
    private readonly notifier: ChatAssignmentNotifier,
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
  ) {}

  saveMsg(
    chatId: string,
    msg: {
      type: MessageType;
      content: ChatMessageContent & { medialUrl?: string };
    },
    sender: {
      id: string;
      type: MessageSenderType;
    },
  ) {
    const repo = this.dataSource.getRepository(Message);
    this.logger.debug(msg, 'Save message with content');
    const fields = getMessageStrategy(msg.type).toEntityFields(msg.content);

    this.logger.debug(fields, 'Save message with fields');

    const message = repo.create({
      ...fields,
      senderId: sender.id,
      senderType: sender.type,
      chat: { id: chatId },
    });

    return repo.save(message);
  }

  /**
   * Retrieves the identifiers of agents assigned to a specific chat.
   *
   * @param chatId - Unique identifier of the chat (from the Chat entity).
   * @returns Promise resolving to an array of agent IDs associated with the chat.
   *
   * @example
   * const agentIds = await getAssigments("chat-123");
   * // agentIds => ["agent-1", "agent-2", "agent-3"]
   *
   */
  async getAssigments(chatId: string) {
    const agents = await this.repo.findAssigments(chatId);
    return agents.map((agent) => agent.id);
  }

  /**
   * Asignación manual/reasignación (Q9/Q14): solo admin/manager pueden quitarle
   * el chat a otro agente; un miembro activo puede asignar un chat libre.
   */
  async assign(
    chatId: string,
    agentId: string,
    options?: { companyId?: string; requesterId?: string },
  ): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.assignToAgent(chatId, agentId, options);

    if (outcome === AssignmentOutcome.ASSIGNED) {
      await this.notifier.notifyAssigned(chatId, agentId);
    }

    return outcome;
  }

  /**
   * Asignación automática al entrar un mensaje (Q1) + avisos (Q12): al agente
   * elegido si se asignó, a los supervisores si quedó en la cola.
   */
  async ensureAssigned(chatId: string, companyId?: string): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.ensureAssigned(chatId, companyId);

    if (outcome === AssignmentOutcome.ASSIGNED) {
      const active = await this.assignment.getActiveAssignment(chatId);
      if (active?.agent?.id) {
        await this.notifier.notifyAssigned(chatId, active.agent.id);
      }
    } else if (outcome === AssignmentOutcome.NO_CANDIDATES) {
      await this.notifier.notifyUnassigned(chatId, companyId);
    }

    return outcome;
  }

  /**
   * Reclamo manual (Q13): el agente se queda con el chat libre. No genera
   * notificación para sí mismo, pero sí evento para otras pestañas/clientes.
   */
  async claim(
    chatId: string,
    agentId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    const outcome = await this.assignment.claim(chatId, agentId, companyId);

    if (outcome === AssignmentOutcome.ASSIGNED) {
      await this.notifier.notifyAssigned(chatId, agentId, false);
    }

    return outcome;
  }

  /** Cola de chats sin asignar de la empresa (Q6/Q14). */
  listUnassigned(companyId?: string, limit?: number) {
    if (!companyId) return [];
    return this.assignment.listUnassigned(companyId, limit);
  }

  updateLastMessage(chatId: string, messageId: string) {
    return this.chatRepo.update(
      { id: chatId },
      { status: ChatStatus.OPEN, lastMessage: { id: messageId } },
    );
  }

  async list(agentId?: string) {
    const agent = agentId ?? this.cls.get('user.id');
    if (!agent) return {};

    const chats = await this.repo.listChatsAssignments(agent);
    return chats.map((chat) => ({
      id: chat.chatId,
      preview: {
        content: chat.messageContent,
        datetime: chat.messageCreated,
      },
      client: {
        id: chat.clientId,
        username: chat.clientUsername,
        profile: chat.clientProfile,
        phone: chat.clientPhone,
      },
      status: chat.chatStatus,
      createdAt: chat.messageCreated,
    }));
  }

  create(dto: ChatDto) {
    const chat = this.chatRepo.save({
      ...dto,
      client: { id: dto.client_id },
    });

    return chat;
  }

  findAll() {
    return this.chatRepo.find();
  }

  findOne(id: number) {
    return `This action returns a #${id} chat`;
  }

  update(id: number, _dto: UpdateChatDto) {
    return `This action updates a #${id} chat`;
  }

  remove(id: number) {
    return `This action removes a #${id} chat`;
  }
}
