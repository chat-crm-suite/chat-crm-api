import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Chat, ChatAssignments } from '../entities/index';
import { ChatStatus, ReasonAssignment } from '../chat.enum';
import { Company } from '../../company/entities/company.entity';
import { Member } from '../../member/member.entity';
import { MemberRole, MemberStatus } from '../../member/member.types';
import { MessageSenderType } from '../../message/message.enum';
import {
  AssignmentCandidate,
  AssignmentOutcome,
  AssignmentSettings,
} from './assignment.types';
import { selectAssignmentCandidate } from './assignment.selection';

/**
 * Motor de asignación de chats (Q2–Q9).
 *
 * Invariantes:
 * - Una sola asignación activa por chat (`unassigned_at IS NULL`), garantizada
 *   dentro de transacción con lock de la fila del chat en MySQL.
 * - Una fila por par (chat, agente) por el unique existente: reasignar al mismo
 *   agente actualiza su fila histórica en vez de insertar.
 * - La asignación manual/claim congela el dueño: la automática nunca reasigna.
 */
@Injectable()
export class ChatAssignmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatAssignmentService.name);
  }

  /**
   * Asignación automática al entrar un mensaje de un chat sin dueño (Q15).
   * Devuelve el desenlace sin lanzar: el pipeline de mensajes no se rompe.
   */
  async ensureAssigned(chatId: string, companyId?: string): Promise<AssignmentOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const chat = await this.lockChat(manager, chatId);
      if (!chat) {
        this.logger.warn({ chatId }, 'Auto-assign skipped: chat not found');
        return AssignmentOutcome.SKIPPED;
      }

      const company = companyId ?? chat.client?.company?.id;
      if (!company) {
        this.logger.warn({ chatId }, 'Auto-assign skipped: company not resolved');
        return AssignmentOutcome.SKIPPED;
      }

      const settings = await this.getSettings(manager, company);
      if (!settings) {
        this.logger.warn({ chatId, company }, 'Auto-assign skipped: company not found');
        return AssignmentOutcome.SKIPPED;
      }
      if (!settings.autoAssignEnabled) {
        return AssignmentOutcome.DISABLED;
      }

      const active = await this.findActiveAssignment(manager, chatId);
      if (active) {
        return AssignmentOutcome.ALREADY_ASSIGNED;
      }

      const candidates = await this.loadCandidates(manager, company);
      const stickyAgentId = settings.sticky
        ? await this.findPreviousAgentId(manager, chatId)
        : null;
      const pick = selectAssignmentCandidate(candidates, settings.maxChats, stickyAgentId);
      if (!pick) {
        this.logger.debug(
          { chatId, company },
          'Auto-assign: no eligible agent, chat stays unassigned',
        );
        return AssignmentOutcome.NO_CANDIDATES;
      }

      await this.upsertAssignment(manager, chatId, pick.agentId, ReasonAssignment.AUTO);
      this.logger.debug(
        { chatId, agentId: pick.agentId },
        'Chat auto-assigned by least load',
      );
      return AssignmentOutcome.ASSIGNED;
    });
  }

  /**
   * Reclamo manual: responder o tomar un chat libre lo asigna al agente (Q13).
   * Idempotente si ya es suyo; CONFLICT si el dueño es otro (Q9).
   */
  async claim(chatId: string, agentId: string, companyId?: string): Promise<AssignmentOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const chat = await this.lockChat(manager, chatId);
      if (!chat) {
        return AssignmentOutcome.SKIPPED;
      }

      const company = companyId ?? chat.client?.company?.id;
      if (!company) {
        this.logger.warn({ chatId }, 'Claim skipped: company not resolved');
        return AssignmentOutcome.SKIPPED;
      }

      const active = await this.findActiveAssignment(manager, chatId);
      if (active) {
        return active.agent?.id === agentId
          ? AssignmentOutcome.ALREADY_ASSIGNED
          : AssignmentOutcome.CONFLICT;
      }

      const member = await this.findActiveMember(manager, company, agentId);
      if (!member) {
        this.logger.warn(
          { chatId, agentId, company },
          'Claim skipped: agent is not an active member of the company',
        );
        return AssignmentOutcome.SKIPPED;
      }

      await this.upsertAssignment(manager, chatId, agentId, ReasonAssignment.MANUAL);
      return AssignmentOutcome.ASSIGNED;
    });
  }

  /**
   * Asignación manual de supervisor (Q9/Q14): desasigna al dueño anterior y
   * asigna al indicado. Si el chat está libre, cualquier member activo puede
   * asignarlo; si ya tiene dueño distinto, solo admin/manager.
   */
  async assignToAgent(
    chatId: string,
    agentId: string,
    options?: { companyId?: string; requesterId?: string },
  ): Promise<AssignmentOutcome> {
    const { companyId, requesterId } = options ?? {};

    return this.dataSource.transaction(async (manager) => {
      const chat = await this.lockChat(manager, chatId);
      if (!chat) {
        throw new NotFoundException('Chat not found');
      }

      const company = companyId ?? chat.client?.company?.id;
      if (!company) {
        throw new BadRequestException('Company context required');
      }

      const target = await this.findActiveMember(manager, company, agentId);
      if (!target) {
        throw new NotFoundException('Agent is not an active member of the company');
      }

      const active = await this.findActiveAssignment(manager, chatId);
      if (active && active.agent?.id !== agentId) {
        if (requesterId) {
          const requester = await this.findActiveMember(manager, company, requesterId);
          const isSupervisor =
            requester?.role === MemberRole.ADMIN || requester?.role === MemberRole.MANAGER;
          if (!isSupervisor) {
            throw new ForbiddenException('Only supervisors can reassign a chat with an owner');
          }
        }

        await manager.getRepository(ChatAssignments).update(
          { chat: { id: chatId }, unassignedAt: IsNull() },
          { unassignedAt: new Date() },
        );
      }

      await this.upsertAssignment(manager, chatId, agentId, ReasonAssignment.MANUAL);
      return AssignmentOutcome.ASSIGNED;
    });
  }

  /** Asignación activa del chat con su agente, o null si está libre. */
  getActiveAssignment(chatId: string) {
    return this.dataSource.getRepository(ChatAssignments).findOne({
      where: { chat: { id: chatId }, unassignedAt: IsNull() },
      relations: ['agent'],
    });
  }

  /**
   * Cola de sin asignar de la empresa (Q6/Q14): chats abiertos/pendientes sin
   * asignación activa, ordenados por antigüedad (el que más espera primero).
   * La empresa se resuelve por `chat.client.company` (los contactos creados por
   * webhook ya se guardan con empresa; datos previos requieren backfill).
   */
  async listUnassigned(companyId: string, limit = 50) {
    const chats = await this.dataSource
      .getRepository(Chat)
      .createQueryBuilder('chat')
      .innerJoinAndSelect('chat.client', 'client')
      .where('client.company_id = :companyId', { companyId })
      .andWhere('chat.status IN (:...statuses)', {
        statuses: [ChatStatus.OPEN, ChatStatus.PENDING],
      })
      .andWhere('chat.deleted_at IS NULL')
      .andWhere(
        (qb) =>
          `NOT EXISTS ${qb
            .subQuery()
            .select('1')
            .from(ChatAssignments, 'ca')
            .where('ca.chat_id = chat.id')
            .andWhere('ca.unassigned_at IS NULL')
            .getQuery()}`,
      )
      .orderBy('chat.lastMessageAt', 'ASC')
      .take(limit)
      .getMany();

    return chats.map((chat) => ({
      id: chat.id,
      preview: {
        content: chat.lastMessage?.content ?? null,
        datetime: chat.lastMessageAt ?? null,
      },
      client: {
        id: chat.client?.id,
        username: chat.client?.username,
        profile: chat.client?.profile,
        phone: chat.client?.phoneNumber,
      },
      status: chat.status,
      createdAt: chat.createdAt,
      waitingSince: chat.lastMessageAt ?? chat.createdAt,
    }));
  }

  /**
   * Vista "sin respuesta" (Q10): chats abiertos/pendientes cuyo último mensaje
   * es del cliente y lleva más de `minutes` esperando. Solo lectura, sin
   * reasignación automática; incluye el dueño actual (o null si está en cola).
   */
  async listNeedsResponse(companyId: string, minutes = 15, limit = 50) {
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const rows = await this.dataSource
      .getRepository(Chat)
      .createQueryBuilder('chat')
      .innerJoin('chat.client', 'client')
      .innerJoin('chat.lastMessage', 'lastMessage')
      .leftJoin(ChatAssignments, 'ca', 'ca.chat_id = chat.id AND ca.unassigned_at IS NULL')
      .leftJoin('ca.agent', 'agent')
      .select('chat.id', 'chatId')
      .addSelect('chat.status', 'chatStatus')
      .addSelect('chat.lastMessageAt', 'lastMessageAt')
      .addSelect('lastMessage.content', 'lastMessageContent')
      .addSelect('client.id', 'clientId')
      .addSelect('client.username', 'clientUsername')
      .addSelect('client.phoneNumber', 'clientPhone')
      .addSelect('client.profile', 'clientProfile')
      .addSelect('agent.id', 'agentId')
      .addSelect('agent.username', 'agentUsername')
      .where('client.company_id = :companyId', { companyId })
      .andWhere('chat.status IN (:...statuses)', {
        statuses: [ChatStatus.OPEN, ChatStatus.PENDING],
      })
      .andWhere('chat.deleted_at IS NULL')
      .andWhere('lastMessage.senderType = :senderType', {
        senderType: MessageSenderType.CLIENT,
      })
      .andWhere('chat.last_message_at < :cutoff', { cutoff })
      .orderBy('chat.lastMessageAt', 'ASC')
      .limit(limit)
      .getRawMany<{
        chatId: string;
        chatStatus: string;
        lastMessageAt: Date | string | null;
        lastMessageContent: string | null;
        clientId: string;
        clientUsername: string | null;
        clientPhone: string;
        clientProfile: string | null;
        agentId: string | null;
        agentUsername: string | null;
      }>();

    return rows.map((row) => ({
      id: row.chatId,
      preview: {
        content: row.lastMessageContent ?? null,
        datetime: row.lastMessageAt ?? null,
      },
      client: {
        id: row.clientId,
        username: row.clientUsername,
        profile: row.clientProfile,
        phone: row.clientPhone,
      },
      status: row.chatStatus,
      waitingSince: row.lastMessageAt,
      agent: row.agentId
        ? { id: row.agentId, username: row.agentUsername }
        : null,
    }));
  }

  private supportsRowLock() {
    return this.dataSource.options.type === 'mysql';
  }

  /**
   * Bloquea la fila del chat para serializar assign/claim concurrentes.
   * En SQLite (tests) no existe FOR UPDATE: la transacción sigue siendo válida.
   */
  private async lockChat(manager: EntityManager, chatId: string): Promise<Chat | null> {
    const rowQuery = manager
      .getRepository(Chat)
      .createQueryBuilder('chat')
      .select('chat.id', 'id')
      .where('chat.id = :chatId', { chatId });
    if (this.supportsRowLock()) {
      rowQuery.setLock('pessimistic_write');
    }

    const row = await rowQuery.getRawOne<{ id: string }>();
    if (!row) return null;

    return manager.getRepository(Chat).findOne({
      where: { id: chatId },
      relations: ['client', 'client.company'],
    });
  }

  private async getSettings(
    manager: EntityManager,
    companyId: string,
  ): Promise<AssignmentSettings | null> {
    const company = await manager.getRepository(Company).findOne({ where: { id: companyId } });
    if (!company) return null;

    return {
      autoAssignEnabled: company.autoAssignEnabled,
      maxChats: company.autoAssignMaxChats,
      sticky: company.autoAssignSticky,
    };
  }

  private findActiveAssignment(manager: EntityManager, chatId: string) {
    return manager.getRepository(ChatAssignments).findOne({
      where: { chat: { id: chatId }, unassignedAt: IsNull() },
      relations: ['agent'],
    });
  }

  private findActiveMember(manager: EntityManager, companyId: string, userId: string) {
    return manager.getRepository(Member).findOne({
      where: {
        user: { id: userId },
        company: { id: companyId },
        status: MemberStatus.ACTIVE,
      },
    });
  }

  /**
   * Candidatos de la empresa: members activos con usuario vigente.
   * No se filtra por rol a propósito: hoy setup solo crea members admin y no
   * existe endpoint para crear agents; filtrar por rol dejaría el motor sin
   * candidatos en producción.
   */
  private async loadCandidates(
    manager: EntityManager,
    companyId: string,
  ): Promise<AssignmentCandidate[]> {
    const rows = await manager
      .getRepository(Member)
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u')
      .leftJoin(ChatAssignments, 'ca', 'ca.agent_id = u.id AND ca.unassigned_at IS NULL')
      .leftJoin(
        'ca.chat',
        'c',
        'c.status NOT IN (:...inactiveStatuses) AND c.deleted_at IS NULL',
        { inactiveStatuses: [ChatStatus.CLOSED, ChatStatus.ARCHIVED] },
      )
      .select('u.id', 'agentId')
      .addSelect('COUNT(c.id)', 'load')
      .addSelect('MAX(ca.assigned_at)', 'lastAssignedAt')
      .where('m.company_id = :companyId', { companyId })
      .andWhere('m.status = :memberStatus', { memberStatus: MemberStatus.ACTIVE })
      .andWhere('u.deleted_at IS NULL')
      .groupBy('u.id')
      .getRawMany<{ agentId: string; load: string | number; lastAssignedAt: Date | string | null }>();

    return rows.map((row) => ({
      agentId: row.agentId,
      load: Number(row.load),
      lastAssignedAt: row.lastAssignedAt ? new Date(row.lastAssignedAt) : null,
    }));
  }

  /** Último agente que tuvo el chat (histórico), para la preferencia sticky. */
  private async findPreviousAgentId(
    manager: EntityManager,
    chatId: string,
  ): Promise<string | null> {
    const row = await manager
      .getRepository(ChatAssignments)
      .createQueryBuilder('ca')
      .select('ca.agent_id', 'agentId')
      .where('ca.chat_id = :chatId', { chatId })
      .orderBy('ca.assigned_at', 'DESC')
      .addOrderBy('ca.chat_assignment_id', 'DESC')
      .limit(1)
      .getRawOne<{ agentId: string | null }>();

    return row?.agentId ?? null;
  }

  /**
   * Mantiene una fila por par (chat, agente) — unique global existente — y una
   * sola activa por chat: reasignar al mismo agente actualiza su fila histórica.
   */
  private async upsertAssignment(
    manager: EntityManager,
    chatId: string,
    agentId: string,
    reason: ReasonAssignment,
  ): Promise<string> {
    const repo = manager.getRepository(ChatAssignments);
    const existing = await repo.findOne({
      where: { chat: { id: chatId }, agent: { id: agentId } },
    });

    if (existing) {
      await repo.update(
        { id: existing.id },
        { unassignedAt: null, assignedAt: new Date(), reason },
      );
      return existing.id;
    }

    const created = await repo.save(
      repo.create({
        chat: { id: chatId },
        agent: { id: agentId },
        reason,
      }),
    );
    return created.id;
  }
}
