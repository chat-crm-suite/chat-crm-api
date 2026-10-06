// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In } from 'typeorm';

import { CompanySettings } from '../../company/entities/company-settings.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { Conversation } from '../entities/conversation.entity';
import { ConversationSocketEvent } from '../../../contracts/index';
import { ConversationGateway } from '../gateways/conversation.gateway';

export const ASSIGNED_NOTIFICATION_TITLE = 'Nuevo chat asignado';
export const UNASSIGNED_NOTIFICATION_TITLE = 'Chat sin asignar';
export const ASSIGNED_NOTIFICATION_TYPE = 'conversation_assigned';
export const UNASSIGNED_NOTIFICATION_TYPE = 'queue_unassigned';

/**
 * Avisos de asignación.
 *
 * - Persiste una notificación por member (campanita) y emite
 *   `notification:new` por socket al room personal `user:{userId}`.
 * - Los avisos de cola a supervisores se deduplican por notificación no leída
 *   del mismo tipo: un aviso vigente por supervisor, no uno por conversación.
 * - Nunca lanza: un fallo de aviso no puede romper el flujo de mensajes.
 */
@Injectable()
export class ConversationAssignmentNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly gateway: ConversationGateway,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationAssignmentNotifier.name);
  }

  /** El member recibió una conversación: notificación persistente + eventos. */
  async notifyAssigned(
    conversationId: string,
    memberId: string,
    notifyMember = true,
  ) {
    try {
      const member = await this.dataSource
        .getRepository(CompanyMember)
        .findOne({
          where: { id: memberId },
          select: { id: true, userId: true, companyId: true },
        });
      if (!member) return;

      let payload: unknown = { conversationId, memberId };

      if (notifyMember) {
        const notification = await this.notifications.create({
          companyId: member.companyId,
          recipientMemberId: memberId,
          type: ASSIGNED_NOTIFICATION_TYPE,
          title: ASSIGNED_NOTIFICATION_TITLE,
          body: 'Tenés un chat nuevo esperando respuesta',
          data: { conversationId },
        });
        payload = this.toRealtimePayload(notification);
      }

      this.emitToUser(member.userId, ConversationSocketEvent.ConversationAssigned, {
        conversationId,
        memberId,
      });

      if (notifyMember) {
        this.emitToUser(member.userId, ConversationSocketEvent.NewNotification, payload);
      }
    } catch (error) {
      this.logger.warn(
        { conversationId, memberId, error: String(error) },
        'Assignment notification failed',
      );
    }
  }

  /** Una conversación quedó sin asignar: aviso a admin/supervisor. */
  async notifyUnassigned(conversationId: string, companyId?: string) {
    try {
      const company = companyId ?? (await this.resolveCompanyId(conversationId));
      if (!company) return;

      const settings = await this.dataSource
        .getRepository(CompanySettings)
        .findOne({ where: { companyId: company } });
      if (!settings?.autoAssignNotifySupervisors) return;

      const supervisors = await this.dataSource
        .getRepository(CompanyMember)
        .find({
          where: {
            companyId: company,
            status: 'active',
            role: In(['admin', 'supervisor']),
          },
        });

      for (const supervisor of supervisors) {
        const alreadyNotified = await this.notifications.hasUnread(
          supervisor.id,
          UNASSIGNED_NOTIFICATION_TYPE,
        );
        if (alreadyNotified) continue;

        const notification = await this.notifications.create({
          companyId: company,
          recipientMemberId: supervisor.id,
          type: UNASSIGNED_NOTIFICATION_TYPE,
          title: UNASSIGNED_NOTIFICATION_TITLE,
          body: 'Hay un chat esperando agente en la cola',
          data: { conversationId },
        });
        this.emitToUser(
          supervisor.userId,
          ConversationSocketEvent.NewNotification,
          this.toRealtimePayload(notification),
        );
      }

      this.gateway.server
        ?.to(`company:${company}`)
        .emit(ConversationSocketEvent.ConversationUnassigned, { conversationId });
    } catch (error) {
      this.logger.warn(
        { conversationId, companyId, error: String(error) },
        'Unassigned notification failed',
      );
    }
  }

  private async resolveCompanyId(conversationId: string): Promise<string | null> {
    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOne({
        where: { id: conversationId },
        select: { companyId: true },
      });
    return conversation?.companyId ?? null;
  }

  private toRealtimePayload(notification: {
    id: string;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
    readAt?: Date | null;
    createdAt: Date;
  }) {
    return {
      id: notification.id,
      title: notification.title,
      body: notification.body ?? null,
      data: notification.data ?? null,
      readAt: notification.readAt ?? null,
      time: notification.createdAt,
    };
  }

  private emitToUser(userId: string, event: string, payload: unknown) {
    this.gateway.server?.to(`user:${userId}`).emit(event, payload);
  }
}
