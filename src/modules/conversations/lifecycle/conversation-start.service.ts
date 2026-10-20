// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, IsNull } from 'typeorm';

import {
  channelCapabilities,
  ConversationErrorCode,
  type ConversationStatus,
  type StartConversationInput,
  type StartConversationResult,
} from '@contracts';
import { AnalyticsSignalEvent } from '../../analytics/events/analytics.events';
import { Channel } from '../../channels/entities/channel.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { TasksService } from '../../tasks/tasks.service';
import { TemplatesService, type PreparedTemplateSend } from '../../templates/templates.service';
import { ConversationAssignmentNotifier } from '../assignment/conversation-assignment.notifier';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { Conversation } from '../entities/conversation.entity';
import {
  ConversationListService,
  isReplyWindowClosed,
  isSupervisorRole,
} from '../listing/conversation-list.service';
import { AgentMessageSender } from '../outbound/agent-message-sender.service';
import { ConversationFanoutService } from '../realtime/conversation-fanout.service';
import type { LifecycleActor } from './conversation-lifecycle.service';

/**
 * `POST /conversations/start` ("Nuevo chat"): open or reuse the conversation
 * of a customer on a channel, assign it, optionally create a follow-up task,
 * all in one transaction; then send the template (the provider call cannot
 * be part of a DB transaction, but the row is saved first like every send).
 *
 * Everything that can refuse (scope, template, window) is checked before
 * the transaction, so a refused start leaves nothing behind.
 */
@Injectable()
export class ConversationStartService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assignments: ConversationAssignmentService,
    private readonly notifier: ConversationAssignmentNotifier,
    private readonly fanout: ConversationFanoutService,
    private readonly listing: ConversationListService,
    private readonly sender: AgentMessageSender,
    private readonly tasks: TasksService,
    private readonly templates: TemplatesService,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(ConversationStartService.name);
  }

  async start(
    actor: LifecycleActor,
    input: StartConversationInput,
  ): Promise<StartConversationResult> {
    const { companyId } = actor;
    const [channel, customer] = await Promise.all([
      this.dataSource.getRepository(Channel).findOne({ where: { id: input.channelId, companyId } }),
      this.dataSource
        .getRepository(Customer)
        .findOne({ where: { id: input.customerId, companyId }, select: { id: true } }),
    ]);
    if (!channel) throw new NotFoundException('Channel not found');
    if (!customer) throw new NotFoundException('Customer not found');

    const assigneeMemberId = input.assigneeMemberId ?? actor.memberId;
    if (assigneeMemberId !== actor.memberId && !isSupervisorRole(actor.role)) {
      throw new ForbiddenException('Only admins and supervisors can assign to someone else');
    }
    const assigneeExists = await this.dataSource.getRepository(CompanyMember).exists({
      where: { id: assigneeMemberId, companyId, status: 'active' },
    });
    if (!assigneeExists) throw new NotFoundException('Member not found');

    const existing = await this.dataSource.getRepository(Conversation).findOne({
      where: { companyId, customerId: customer.id, channelId: channel.id, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    let prepared: PreparedTemplateSend | null = null;
    if (input.template) {
      prepared = await this.templates.prepareSend(
        actor,
        { channelId: channel.id, channelType: channel.type },
        input.template,
      );
    } else if (
      channelCapabilities(channel.type)?.supportsTemplates &&
      isReplyWindowClosed(channel.type, existing?.lastInboundAt)
    ) {
      throw new ConflictException({
        code: ConversationErrorCode.ReplyWindowClosed,
        message: 'The reply window is closed: a template is required to start',
      });
    }

    const previousStatus: ConversationStatus | null = existing?.status ?? null;
    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Conversation);
      const conversation =
        existing ??
        (await repo.save(
          repo.create({
            companyId,
            customerId: customer.id,
            channelId: channel.id,
            status: 'open',
            priority: 'low',
          }),
        ));
      if (existing && existing.status !== 'open') {
        await repo.update(
          { id: existing.id },
          { status: 'open', closedAt: null, closedByMemberId: null },
        );
      }

      const assigned = await this.assignments.assignWithin(
        manager,
        conversation.id,
        assigneeMemberId,
        actor.memberId,
      );

      const taskId = input.task
        ? await this.tasks.createWithin(manager, actor, {
            ...input.task,
            priority: 'medium',
            assigneeMemberId,
            conversationId: conversation.id,
          })
        : null;

      return { conversationId: conversation.id, assigned, taskId };
    });
    const { conversationId, assigned, taskId } = outcome;

    if (assigned) await this.notifier.notifyAssigned(conversationId, assigneeMemberId);
    if (!existing) {
      const item = await this.listing.hydrateOne(conversationId);
      if (item) this.fanout.emitCreated(companyId, item);
    } else if (previousStatus && previousStatus !== 'open') {
      this.fanout.emitStatusChanged(companyId, {
        conversationId,
        status: 'open',
        previousStatus,
        byMemberId: actor.memberId,
        at: new Date(),
      });
    }
    if (taskId) await this.tasks.announceCreated(companyId, taskId);

    let messageId: string | null = null;
    if (prepared && input.template) {
      const message = await this.sender.sendTemplate({
        conversationId,
        companyId,
        senderMemberId: actor.memberId,
        clientMessageId: input.template.clientMessageId ?? null,
        ...prepared,
      });
      messageId = message.id;
    }

    this.eventBus?.publish(new AnalyticsSignalEvent(companyId, ['live']));

    const conversation = await this.listing.hydrateOne(conversationId, actor.memberId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    return { conversation, created: !existing, taskId, messageId };
  }
}
