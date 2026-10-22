// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull } from 'typeorm';

import { AnalyticsSignalEvent } from '../../analytics/events/analytics.events';
import { CompanySettings } from '../../company/entities/company-settings.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { NotificationDispatcher } from '../../notifications/notification.dispatcher';
import { ConversationAssignment } from '../entities/conversation-assignment.entity';
import { Conversation } from '../entities/conversation.entity';
import {
  conversationGroupKey,
  ConversationSocketEvent,
  NotificationTypeSchema,
} from '@contracts';
import { ConversationGateway, userRoom } from '../gateways/conversation.gateway';
import { ConversationFanoutService } from '../realtime/conversation-fanout.service';

export const ASSIGNED_NOTIFICATION_TITLE = 'Nuevo chat asignado';
export const UNASSIGNED_NOTIFICATION_TITLE = 'Chat sin asignar';
export const ASSIGNED_NOTIFICATION_TYPE = NotificationTypeSchema.enum.conversation_assigned;
export const UNASSIGNED_NOTIFICATION_TYPE = NotificationTypeSchema.enum.queue_unassigned;
/** Every queued conversation grows one unread "chats sin asignar" row. */
export const QUEUE_GROUP_KEY = 'queue';
/** Repeated releases of one conversation within this window notify once. */
const UNASSIGNED_DEDUPE_BUCKET_MS = 60_000;

export interface AssignmentNoticeOptions {
  /** `false` = self-claim: data events only, no notification. */
  notify?: boolean;
  /** Who caused it; never notified about their own action. */
  actorMemberId?: string | null;
}

/**
 * Assignment notices.
 *
 * - Data events (`conversation:assigned`, `conversation:unassigned`) keep the
 *   inbox lists fresh and never toast on their own.
 * - The user-facing notice goes through `NotificationDispatcher` (queued,
 *   deduped, muted per member, grouped), so one assignment = one toast.
 * - Never throws: a failed notice must not break the message flow.
 */
@Injectable()
export class ConversationAssignmentNotifier {
  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly gateway: ConversationGateway,
    private readonly fanout: ConversationFanoutService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(ConversationAssignmentNotifier.name);
  }

  /** The member got the conversation: data event + one notification. */
  async notifyAssigned(
    conversationId: string,
    memberId: string,
    options: AssignmentNoticeOptions = {},
  ) {
    try {
      const member = await this.dataSource
        .getRepository(CompanyMember)
        .findOne({
          where: { id: memberId },
          select: { id: true, userId: true, companyId: true },
        });
      if (!member) return;

      // Owner, load and the waiting list of the floor changed.
      this.eventBus?.publish(new AnalyticsSignalEvent(member.companyId, ['live']));

      // Agents that were reading the queued thread lose it to the new owner.
      await this.gateway.revokeConversationAccess(
        conversationId,
        member.companyId,
        memberId,
      );

      this.gateway.server
        ?.to(userRoom(member.userId))
        .emit(ConversationSocketEvent.ConversationAssigned, { conversationId, memberId });

      if (options.notify === false || options.actorMemberId === memberId) return;

      const assignment = await this.dataSource.getRepository(ConversationAssignment).findOne({
        where: { conversationId, memberId, unassignedAt: IsNull() },
        select: { id: true },
      });
      const customer = await this.customerName(conversationId);

      await this.dispatcher.notify({
        companyId: member.companyId,
        type: ASSIGNED_NOTIFICATION_TYPE,
        audience: { memberIds: [memberId] },
        title: ASSIGNED_NOTIFICATION_TITLE,
        body: customer
          ? `${customer} espera tu respuesta`
          : 'Tienes un chat nuevo esperando respuesta',
        data: { conversationId },
        // One notice per assignment row: a retry or a second code path
        // announcing the same assignment is absorbed.
        dedupeKey: `assigned:${conversationId}:${assignment?.id ?? memberId}`,
        // Read together with the chat's message notices when it is opened.
        groupKey: conversationGroupKey(conversationId),
        excludeMemberIds: options.actorMemberId ? [options.actorMemberId] : [],
      });
    } catch (error) {
      this.logger.warn(
        { conversationId, memberId, error: String(error) },
        'Assignment notification failed',
      );
    }
  }

  /**
   * The conversation sits in the queue: list refresh for staff and agents,
   * plus a grouped notice for admin/supervisor when the company wants it.
   */
  async notifyUnassigned(
    conversationId: string,
    companyId?: string,
    options: Pick<AssignmentNoticeOptions, 'actorMemberId'> = {},
  ) {
    try {
      const company = companyId ?? (await this.resolveCompanyId(conversationId));
      if (!company) return;

      this.eventBus?.publish(new AnalyticsSignalEvent(company, ['live']));
      this.fanout.emitUnassigned(company, conversationId);

      const settings = await this.dataSource
        .getRepository(CompanySettings)
        .findOne({ where: { companyId: company } });
      if (!settings?.autoAssignNotifySupervisors) return;

      const customer = await this.customerName(conversationId);
      const bucket = Math.floor(Date.now() / UNASSIGNED_DEDUPE_BUCKET_MS);

      await this.dispatcher.notify({
        companyId: company,
        type: UNASSIGNED_NOTIFICATION_TYPE,
        audience: { roles: ['admin', 'supervisor'] },
        title: UNASSIGNED_NOTIFICATION_TITLE,
        body: customer
          ? `${customer} espera un agente en la cola`
          : 'Hay un chat esperando agente en la cola',
        data: { conversationId },
        dedupeKey: `unassigned:${conversationId}:${bucket}`,
        groupKey: QUEUE_GROUP_KEY,
        excludeMemberIds: options.actorMemberId ? [options.actorMemberId] : [],
      });
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

  /** Display name, else phone; null when unknown (generic copy then). */
  private async customerName(conversationId: string): Promise<string | null> {
    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: conversationId },
      relations: { customer: true },
      select: { id: true, customer: { id: true, displayName: true, phoneNumber: true } },
    });
    const customer = conversation?.customer;

    return customer?.displayName?.trim() || customer?.phoneNumber || null;
  }
}
