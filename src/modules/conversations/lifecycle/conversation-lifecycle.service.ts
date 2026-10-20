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
import { DataSource, In } from 'typeorm';

import type {
  ConversationLifecycleResult,
  ConversationListItem,
  ConversationPriority,
  ConversationStatus,
  MemberRole,
  TransferConversationInput,
} from '@contracts';
import { AnalyticsSignalEvent } from '../../analytics/events/analytics.events';
import { CasesService } from '../../cases/cases.service';
import type { Case } from '../../cases/entities/case.entity';
import { AssignmentOutcome } from '../assignment/assignment.types';
import { ConversationAssignmentNotifier } from '../assignment/conversation-assignment.notifier';
import { ConversationAssignmentService } from '../assignment/conversation-assignment.service';
import { Conversation } from '../entities/conversation.entity';
import { ConversationListService, isSupervisorRole } from '../listing/conversation-list.service';
import { ConversationAccessService } from '../realtime/conversation-access.service';
import { ConversationFanoutService } from '../realtime/conversation-fanout.service';

/** Verified caller of a lifecycle action. */
export interface LifecycleActor {
  companyId: string;
  memberId: string;
  role: MemberRole;
  userId: string | null;
}

const REOPENABLE: ConversationStatus[] = ['pending', 'closed'];

/**
 * Conversation lifecycle: Abierto (`open`) / En espera (`pending`) /
 * Resuelto (`closed`), plus transfer and release as owner actions.
 *
 * - Access: the thread rules (admin/supervisor any conversation of the
 *   company; agents their own or queued ones). Release and transfer also
 *   need the agent to be the current owner.
 * - Every status change emits `conversation:status:changed` (thread +
 *   company rooms) and the `live` analytics signal, which also drops the
 *   cached work-queue counts.
 * - An inbound message always turns `pending`/`closed` back into `open`.
 */
@Injectable()
export class ConversationLifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cases: CasesService,
    private readonly access: ConversationAccessService,
    private readonly assignments: ConversationAssignmentService,
    private readonly notifier: ConversationAssignmentNotifier,
    private readonly fanout: ConversationFanoutService,
    private readonly listing: ConversationListService,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(ConversationLifecycleService.name);
  }

  /**
   * Resolve: closes the open case (note kept on it), `status=closed` with who
   * and when, and the owner goes back to the queue (a `release` history row).
   */
  async resolve(
    conversationId: string,
    actor: LifecycleActor,
    note?: string,
  ): Promise<ConversationLifecycleResult> {
    const conversation = await this.load(conversationId, actor);
    const previousStatus = conversation.status;

    // Before the release: the case owner is the assignee at closing time.
    const kase = (await this.cases.findOpen(conversationId))
      ? await this.cases.close(conversationId, actor.memberId, note)
      : await this.cases.findLatest(conversationId);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Conversation).update(
        { id: conversationId },
        { status: 'closed', closedAt: new Date(), closedByMemberId: actor.memberId },
      );
      await this.assignments.releaseConversation(manager, conversationId, {
        byMemberId: actor.memberId,
      });
    });

    this.changed(actor.companyId, conversationId, previousStatus, 'closed', actor.memberId, [
      'live',
      'cases',
    ]);
    return { id: conversationId, status: 'closed', assignee: null, case: toCaseView(kase) };
  }

  /** En espera: waiting on the customer; the owner keeps it. */
  async setPending(
    conversationId: string,
    actor: LifecycleActor,
  ): Promise<ConversationLifecycleResult> {
    const conversation = await this.load(conversationId, actor);
    if (conversation.status !== 'pending') {
      await this.dataSource
        .getRepository(Conversation)
        .update({ id: conversationId }, { status: 'pending' });
      this.changed(actor.companyId, conversationId, conversation.status, 'pending', actor.memberId);
    }

    return this.result(conversationId, 'pending');
  }

  /** Back to `open`, with an open case (a reopen when within the window). */
  async reopen(
    conversationId: string,
    actor: LifecycleActor,
  ): Promise<ConversationLifecycleResult> {
    const conversation = await this.load(conversationId, actor);
    if (conversation.status !== 'open') {
      await this.dataSource
        .getRepository(Conversation)
        .update({ id: conversationId }, { status: 'open', closedAt: null, closedByMemberId: null });
    }
    await this.cases.ensureOpen(conversationId);

    if (conversation.status !== 'open') {
      this.changed(actor.companyId, conversationId, conversation.status, 'open', actor.memberId, [
        'live',
        'cases',
      ]);
    }
    return this.result(conversationId, 'open');
  }

  /** Back to the queue (`assignee=null`); the status does not change. */
  async release(
    conversationId: string,
    actor: LifecycleActor,
    note?: string,
  ): Promise<ConversationLifecycleResult> {
    const conversation = await this.load(conversationId, actor, { ownerOnly: true });

    const released = await this.dataSource.transaction((manager) =>
      this.assignments.releaseConversation(manager, conversationId, {
        byMemberId: actor.memberId,
        note: note ?? null,
      }),
    );
    if (released) {
      await this.notifier.notifyUnassigned(conversationId, actor.companyId, {
        actorMemberId: actor.memberId,
      });
    }

    return this.result(conversationId, conversation.status);
  }

  /**
   * Reassign to another member (reason `transfer`, note on the new row).
   * 409 when that member already owns it.
   */
  async transfer(
    conversationId: string,
    actor: LifecycleActor,
    input: TransferConversationInput,
  ): Promise<ConversationLifecycleResult> {
    const conversation = await this.load(conversationId, actor, { ownerOnly: true });
    const owner = await this.access.getActiveAssignee(conversationId);
    if (owner?.memberId === input.memberId) {
      throw new ConflictException('The member already owns this conversation');
    }

    const outcome = await this.assignments.assignToAgent(conversationId, input.memberId, {
      companyId: actor.companyId,
      assignedByMemberId: actor.memberId,
      note: input.note ?? null,
    });
    if (outcome === AssignmentOutcome.ASSIGNED) {
      await this.notifier.notifyAssigned(conversationId, input.memberId, {
        actorMemberId: actor.memberId,
      });
    }

    return this.result(conversationId, conversation.status);
  }

  /** Owner, admin or supervisor; `null` clears it. Answers the list item. */
  async setPriority(
    conversationId: string,
    actor: LifecycleActor,
    priority: ConversationPriority | null,
  ): Promise<ConversationListItem> {
    await this.load(conversationId, actor, { ownerOnly: true });
    await this.dataSource.getRepository(Conversation).update({ id: conversationId }, { priority });
    this.eventBus?.publish(new AnalyticsSignalEvent(actor.companyId, ['live']));

    const item = await this.listing.hydrateOne(conversationId, actor.memberId);
    if (!item) throw new NotFoundException('Conversation not found');
    return item;
  }

  /**
   * Inbound customer message: a `pending`/`closed` conversation is `open`
   * again. Conditional on the status read, so concurrent messages emit once.
   */
  async reopenOnInbound(conversationId: string): Promise<boolean> {
    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: conversationId },
      select: { id: true, companyId: true, status: true },
    });
    if (!conversation || !REOPENABLE.includes(conversation.status)) return false;

    const result = await this.dataSource
      .getRepository(Conversation)
      .update(
        { id: conversationId, status: In([conversation.status]) },
        { status: 'open', closedAt: null, closedByMemberId: null },
      );
    if (!result.affected) return false;

    this.changed(conversation.companyId, conversationId, conversation.status, 'open', null);
    return true;
  }

  /**
   * The conversation, after the thread access check (403 for foreign or
   * unreachable ones). `ownerOnly`: an agent must be the current owner.
   */
  private async load(
    conversationId: string,
    actor: LifecycleActor,
    options: { ownerOnly?: boolean } = {},
  ): Promise<Conversation> {
    await this.access.assertCanJoinConversation(conversationId, {
      userId: actor.userId,
      companyId: actor.companyId,
      authenticated: true,
    });

    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: conversationId, companyId: actor.companyId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (options.ownerOnly && !isSupervisorRole(actor.role)) {
      const owner = await this.access.getActiveAssignee(conversationId);
      if (owner?.memberId !== actor.memberId) {
        throw new ForbiddenException('Only the owner, an admin or a supervisor can do this');
      }
    }

    return conversation;
  }

  private async result(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<ConversationLifecycleResult> {
    const [assignees, kase] = await Promise.all([
      this.listing.assignees([conversationId]),
      this.cases.findLatest(conversationId),
    ]);

    return {
      id: conversationId,
      status,
      assignee: assignees.get(conversationId) ?? null,
      case: toCaseView(kase),
    };
  }

  private changed(
    companyId: string,
    conversationId: string,
    previousStatus: ConversationStatus,
    status: ConversationStatus,
    byMemberId: string | null,
    scopes: ('live' | 'cases')[] = ['live'],
  ): void {
    // Never throws: a failed emit is logged by the fanout.
    void this.fanout.emitStatusChanged(companyId, {
      conversationId,
      status,
      previousStatus,
      byMemberId,
      at: new Date(),
    });
    this.eventBus?.publish(new AnalyticsSignalEvent(companyId, scopes));
  }
}

/** `CaseSchema` view of a case row (or null). */
export function toCaseView(row: Case | null | undefined): ConversationLifecycleResult['case'] {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: row.status,
    openedAt: row.openedAt,
    firstResponseAt: row.firstResponseAt ?? null,
    firstResponderMemberId: row.firstResponderMemberId ?? null,
    closedAt: row.closedAt ?? null,
    closedByMemberId: row.closedByMemberId ?? null,
    reopenOfCaseId: row.reopenOfCaseId ?? null,
  };
}
