import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import type { AssignmentReason } from '../../../contracts/index';
import { CompanySettings } from '../../company/entities/company-settings.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';
import { selectAssignmentCandidate } from './assignment.selection';
import {
  AssignmentCandidate,
  AssignmentOutcome,
  AssignmentSettings,
} from './assignment.types';

/**
 * Motor de asignación de conversaciones (v2).
 *
 * Invariantes:
 * - Una sola asignación activa por conversación (`unassigned_at IS NULL`),
 *   garantizada dentro de transacción con lock de la fila en MySQL.
 * - Cada asignación es una fila histórica nueva (ya no hay UNIQUE por par):
 *   reasignar cierra la activa e inserta una fila con su `reason`.
 * - La asignación manual/claim congela el dueño: la automática nunca reasigna.
 * - El tenant sale de `conversations.company_id` (NOT NULL): ya no existe el
 *   camino "company not resolved".
 */
@Injectable()
export class ConversationAssignmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationAssignmentService.name);
  }

  /** Asignación automática al entrar un mensaje de una conversación sin dueño. */
  async ensureAssigned(
    conversationId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await this.lockConversation(manager, conversationId);
      if (!conversation) {
        this.logger.warn({ conversationId }, 'Auto-assign skipped: conversation not found');
        return AssignmentOutcome.SKIPPED;
      }

      const company = companyId ?? conversation.companyId;
      const settings = await this.getSettings(manager, company);
      if (!settings) {
        this.logger.warn(
          { conversationId, company },
          'Auto-assign skipped: company settings not found',
        );
        return AssignmentOutcome.SKIPPED;
      }
      if (!settings.autoAssignEnabled) {
        return AssignmentOutcome.DISABLED;
      }

      const active = await this.findActiveAssignment(manager, conversationId);
      if (active) {
        return AssignmentOutcome.ALREADY_ASSIGNED;
      }

      const candidates = await this.loadCandidates(manager, company);
      const stickyMemberId = settings.sticky
        ? await this.findPreviousMemberId(manager, conversationId)
        : null;
      const pick = selectAssignmentCandidate(
        candidates,
        settings.maxOpen,
        stickyMemberId,
      );
      if (!pick) {
        this.logger.debug(
          { conversationId, company },
          'Auto-assign: no eligible member, conversation stays unassigned',
        );
        return AssignmentOutcome.NO_CANDIDATES;
      }

      await this.assign(manager, conversationId, pick.memberId, 'auto');
      this.logger.debug(
        { conversationId, memberId: pick.memberId },
        'Conversation auto-assigned by least load',
      );
      return AssignmentOutcome.ASSIGNED;
    });
  }

  /** Reclamo del agente autenticado (resuelve member por userId + company). */
  async claimForUser(
    conversationId: string,
    userId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await this.lockConversation(manager, conversationId);
      if (!conversation) return AssignmentOutcome.SKIPPED;

      const company = companyId ?? conversation.companyId;
      const member = await this.findActiveMemberByUser(manager, company, userId);
      if (!member) {
        this.logger.warn(
          { conversationId, userId, company },
          'Claim skipped: user is not an active member of the company',
        );
        return AssignmentOutcome.SKIPPED;
      }

      return this.claimWithinTransaction(manager, conversationId, member.id);
    });
  }

  /** Reclamo desde el pipeline de mensajes (ya tenemos el member id). */
  async claimForMember(
    conversationId: string,
    memberId: string,
    companyId?: string,
  ): Promise<AssignmentOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await this.lockConversation(manager, conversationId);
      if (!conversation) return AssignmentOutcome.SKIPPED;

      const company = companyId ?? conversation.companyId;
      const member = await this.findActiveMemberById(manager, company, memberId);
      if (!member) return AssignmentOutcome.SKIPPED;

      return this.claimWithinTransaction(manager, conversationId, member.id);
    });
  }

  /**
   * Asignación manual de supervisor: desasigna al dueño anterior y asigna al
   * indicado. Si la conversación está libre, cualquier member activo puede
   * asignarla; si ya tiene dueño distinto, solo admin/supervisor.
   */
  async assignToAgent(
    conversationId: string,
    memberId: string,
    options?: { companyId?: string; requesterId?: string },
  ): Promise<AssignmentOutcome> {
    const { companyId, requesterId } = options ?? {};

    return this.dataSource.transaction(async (manager) => {
      const conversation = await this.lockConversation(manager, conversationId);
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const company = companyId ?? conversation.companyId;
      if (!company) {
        throw new BadRequestException('Company context required');
      }

      const target = await this.findActiveMemberById(manager, company, memberId);
      if (!target) {
        throw new NotFoundException(
          'Member is not an active member of the company',
        );
      }

      const active = await this.findActiveAssignment(manager, conversationId);
      let assignedByMemberId: string | null = null;

      if (active && active.memberId !== memberId) {
        if (requesterId) {
          const requester = await this.findActiveMemberByUser(
            manager,
            company,
            requesterId,
          );
          const isSupervisor =
            requester?.role === 'admin' || requester?.role === 'supervisor';
          if (!isSupervisor) {
            throw new ForbiddenException(
              'Only supervisors can reassign a conversation with an owner',
            );
          }
          assignedByMemberId = requester?.id ?? null;
        }

        await this.closeActiveAssignment(manager, conversationId);
      }

      await this.assign(
        manager,
        conversationId,
        memberId,
        'manual',
        assignedByMemberId,
      );
      return AssignmentOutcome.ASSIGNED;
    });
  }

  /** Asignación activa de la conversación con su member (y usuario), o null. */
  getActiveAssignment(conversationId: string) {
    return this.dataSource.getRepository(ConversationAssignment).findOne({
      where: { conversationId, unassignedAt: IsNull() },
      relations: { member: { user: true } },
    });
  }

  /**
   * Cola de sin asignar de la empresa: conversaciones abiertas/pendientes sin
   * asignación activa, ordenadas por antigüedad (la que más espera primero).
   */
  async listUnassigned(companyId: string, limit = 50) {
    const conversations = await this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .innerJoinAndSelect('conversation.customer', 'customer')
      .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
      .where('conversation.company_id = :companyId', { companyId })
      .andWhere('conversation.status IN (:...statuses)', {
        statuses: ['open', 'pending'],
      })
      .andWhere('conversation.deleted_at IS NULL')
      .andWhere(
        (qb) =>
          `NOT EXISTS ${qb
            .subQuery()
            .select('1')
            .from(ConversationAssignment, 'ca')
            .where('ca.conversation_id = conversation.id')
            .andWhere('ca.unassigned_at IS NULL')
            .getQuery()}`,
      )
      .orderBy('conversation.lastMessageAt', 'ASC')
      .take(limit)
      .getMany();

    return conversations.map((conversation) => ({
      id: conversation.id,
      preview: {
        content: conversation.lastMessage?.body ?? null,
        datetime: conversation.lastMessageAt ?? null,
      },
      customer: {
        id: conversation.customer?.id,
        displayName: conversation.customer?.displayName,
        phone: conversation.customer?.phoneNumber,
      },
      status: conversation.status,
      createdAt: conversation.createdAt,
      waitingSince: conversation.lastMessageAt ?? conversation.createdAt,
    }));
  }

  /**
   * Vista "sin respuesta": conversaciones abiertas/pendientes cuyo último
   * mensaje es del cliente y lleva más de `minutes` esperando. Solo lectura.
   */
  async listNeedsResponse(companyId: string, minutes = 15, limit = 50) {
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const rows = await this.dataSource
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .innerJoin('conversation.customer', 'customer')
      .innerJoin('conversation.lastMessage', 'lastMessage')
      .leftJoin(
        ConversationAssignment,
        'ca',
        'ca.conversation_id = conversation.id AND ca.unassigned_at IS NULL',
      )
      .leftJoin('ca.member', 'member')
      .leftJoin('member.user', 'memberUser')
      .select('conversation.id', 'conversationId')
      .addSelect('conversation.status', 'conversationStatus')
      .addSelect('conversation.lastMessageAt', 'lastMessageAt')
      .addSelect('lastMessage.body', 'lastMessageBody')
      .addSelect('customer.id', 'customerId')
      .addSelect('customer.displayName', 'customerDisplayName')
      .addSelect('customer.phoneNumber', 'customerPhone')
      .addSelect('member.id', 'memberId')
      .addSelect('memberUser.username', 'memberUsername')
      .where('conversation.company_id = :companyId', { companyId })
      .andWhere('conversation.status IN (:...statuses)', {
        statuses: ['open', 'pending'],
      })
      .andWhere('conversation.deleted_at IS NULL')
      .andWhere('lastMessage.direction = :direction', { direction: 'inbound' })
      .andWhere('conversation.last_message_at < :cutoff', { cutoff })
      .orderBy('conversation.lastMessageAt', 'ASC')
      .limit(limit)
      .getRawMany<{
        conversationId: string;
        conversationStatus: string;
        lastMessageAt: Date | string | null;
        lastMessageBody: string | null;
        customerId: string;
        customerDisplayName: string | null;
        customerPhone: string | null;
        memberId: string | null;
        memberUsername: string | null;
      }>();

    return rows.map((row) => ({
      id: row.conversationId,
      preview: {
        content: row.lastMessageBody ?? null,
        datetime: row.lastMessageAt ?? null,
      },
      customer: {
        id: row.customerId,
        displayName: row.customerDisplayName,
        phone: row.customerPhone,
      },
      status: row.conversationStatus,
      waitingSince: row.lastMessageAt,
      member: row.memberId
        ? { id: row.memberId, username: row.memberUsername }
        : null,
    }));
  }

  private async claimWithinTransaction(
    manager: EntityManager,
    conversationId: string,
    memberId: string,
  ): Promise<AssignmentOutcome> {
    const active = await this.findActiveAssignment(manager, conversationId);
    if (active) {
      return active.memberId === memberId
        ? AssignmentOutcome.ALREADY_ASSIGNED
        : AssignmentOutcome.CONFLICT;
    }

    await this.assign(manager, conversationId, memberId, 'claim');
    return AssignmentOutcome.ASSIGNED;
  }

  private supportsRowLock() {
    return this.dataSource.options.type === 'mysql';
  }

  /**
   * Bloquea la fila de la conversación para serializar assign/claim
   * concurrentes. En SQLite (tests) no existe FOR UPDATE: la transacción sigue
   * siendo válida.
   */
  private async lockConversation(
    manager: EntityManager,
    conversationId: string,
  ): Promise<Conversation | null> {
    const rowQuery = manager
      .getRepository(Conversation)
      .createQueryBuilder('conversation')
      .select('conversation.id', 'id')
      .where('conversation.id = :conversationId', { conversationId });
    if (this.supportsRowLock()) {
      rowQuery.setLock('pessimistic_write');
    }

    const row = await rowQuery.getRawOne<{ id: string }>();
    if (!row) return null;

    return manager.getRepository(Conversation).findOne({
      where: { id: conversationId },
    });
  }

  private async getSettings(
    manager: EntityManager,
    companyId: string,
  ): Promise<AssignmentSettings | null> {
    const settings = await manager
      .getRepository(CompanySettings)
      .findOne({ where: { companyId } });
    if (!settings) return null;

    return {
      autoAssignEnabled: settings.autoAssignEnabled,
      maxOpen: settings.autoAssignMaxOpen,
      sticky: settings.autoAssignSticky,
    };
  }

  private findActiveAssignment(manager: EntityManager, conversationId: string) {
    return manager.getRepository(ConversationAssignment).findOne({
      where: { conversationId, unassignedAt: IsNull() },
    });
  }

  private findActiveMemberByUser(
    manager: EntityManager,
    companyId: string,
    userId: string,
  ) {
    return manager.getRepository(CompanyMember).findOne({
      where: { companyId, userId, status: 'active' },
    });
  }

  private findActiveMemberById(
    manager: EntityManager,
    companyId: string,
    memberId: string,
  ) {
    return manager.getRepository(CompanyMember).findOne({
      where: { id: memberId, companyId, status: 'active' },
    });
  }

  /**
   * Candidatos de la empresa: members activos con usuario vigente. No se filtra
   * por rol a propósito: cualquier member activo puede recibir asignaciones.
   */
  private async loadCandidates(
    manager: EntityManager,
    companyId: string,
  ): Promise<AssignmentCandidate[]> {
    const rows = await manager
      .getRepository(CompanyMember)
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .leftJoin(
        ConversationAssignment,
        'ca',
        'ca.member_id = member.id AND ca.unassigned_at IS NULL',
      )
      .leftJoin(
        'ca.conversation',
        'conversation',
        'conversation.status NOT IN (:...inactiveStatuses) AND conversation.deleted_at IS NULL',
        { inactiveStatuses: ['closed', 'archived'] },
      )
      .select('member.id', 'memberId')
      .addSelect('COUNT(conversation.id)', 'load')
      .addSelect('MAX(ca.assigned_at)', 'lastAssignedAt')
      .where('member.company_id = :companyId', { companyId })
      .andWhere('member.status = :memberStatus', { memberStatus: 'active' })
      .andWhere('user.deleted_at IS NULL')
      .groupBy('member.id')
      .getRawMany<{
        memberId: string;
        load: string | number;
        lastAssignedAt: Date | string | null;
      }>();

    return rows.map((row) => ({
      memberId: row.memberId,
      load: Number(row.load),
      lastAssignedAt: row.lastAssignedAt ? new Date(row.lastAssignedAt) : null,
    }));
  }

  /** Último member que tuvo la conversación, para la preferencia sticky. */
  private async findPreviousMemberId(
    manager: EntityManager,
    conversationId: string,
  ): Promise<string | null> {
    const row = await manager
      .getRepository(ConversationAssignment)
      .createQueryBuilder('ca')
      .select('ca.member_id', 'memberId')
      .where('ca.conversation_id = :conversationId', { conversationId })
      .orderBy('ca.assigned_at', 'DESC')
      .limit(1)
      .getRawOne<{ memberId: string | null }>();

    return row?.memberId ?? null;
  }

  private closeActiveAssignment(
    manager: EntityManager,
    conversationId: string,
  ) {
    return manager.getRepository(ConversationAssignment).update(
      { conversationId, unassignedAt: IsNull() },
      { unassignedAt: new Date() },
    );
  }

  /**
   * Cierra la asignación activa (si la hay), inserta la fila histórica nueva y
   * denormaliza el dueño actual en `conversations.assigned_member_id`.
   */
  private async assign(
    manager: EntityManager,
    conversationId: string,
    memberId: string,
    reason: AssignmentReason,
    assignedByMemberId?: string | null,
  ): Promise<void> {
    await this.closeActiveAssignment(manager, conversationId);

    await manager.getRepository(ConversationAssignment).save(
      manager.getRepository(ConversationAssignment).create({
        conversationId,
        memberId,
        reason,
        assignedAt: new Date(),
        assignedByMemberId: assignedByMemberId ?? null,
      }),
    );

    await manager
      .getRepository(Conversation)
      .update({ id: conversationId }, { assignedMemberId: memberId });
  }
}
