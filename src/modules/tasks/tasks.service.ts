// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';

import {
  TaskSocketEvent,
  type CreateTaskInput,
  type ListTasksQuery,
  type MemberRole,
  type Task as TaskView,
  type TaskChanged,
  type UpdateTaskInput,
} from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { memberDisplayName } from '../company-members/member-name';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationGateway } from '../conversations/gateways/conversation.gateway';
import { Customer } from '../customers/entities/customer.entity';
import { Task } from './entities/task.entity';
import { WorkQueueCache } from './work-queue.cache';

/** Who acts: tasks are always scoped to the verified tenant. */
export interface TaskActor {
  companyId: string;
  memberId: string;
  role: MemberRole;
}

const isSupervisor = (role: MemberRole) => role === 'admin' || role === 'supervisor';

/**
 * Manual tasks. Agents see and edit only their own; admin/supervisor see the
 * whole company and may assign to anyone. Every change emits `task:changed`
 * to the assignee's user room and the company room, and drops the cached
 * work-queue counts.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly dataSource: DataSource,
    private readonly gateway: ConversationGateway,
    private readonly cache: WorkQueueCache,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TasksService.name);
  }

  /** `GET /tasks`: open first, then by due date (nulls last), then creation. */
  async list(actor: TaskActor, query: ListTasksQuery): Promise<TaskView[]> {
    if ((query.scope === 'all' || query.assigneeId) && !isSupervisor(actor.role)) {
      throw new ForbiddenException('Only admins and supervisors can list other members tasks');
    }

    const qb = this.viewQuery(actor.companyId);
    if (query.scope === 'mine') {
      qb.andWhere('task.assignee_member_id = :me', { me: actor.memberId });
    } else if (query.assigneeId) {
      qb.andWhere('task.assignee_member_id = :assigneeId', { assigneeId: query.assigneeId });
    }
    if (query.status) qb.andWhere('task.status = :status', { status: query.status });
    if (query.conversationId) {
      qb.andWhere('task.conversation_id = :conversationId', {
        conversationId: query.conversationId,
      });
    }

    const rows = await ordered(qb).limit(query.limit).getMany();
    const now = new Date();
    return rows.map((row) => toTaskView(row, now));
  }

  /** Open tasks of one member (or the whole company), for the work queue. */
  async listOpen(
    companyId: string,
    assigneeId: string | null,
    limit = 100,
  ): Promise<TaskView[]> {
    const qb = this.viewQuery(companyId).andWhere('task.status = :open', { open: 'open' });
    if (assigneeId) qb.andWhere('task.assignee_member_id = :assigneeId', { assigneeId });

    const rows = await ordered(qb).limit(limit).getMany();
    const now = new Date();
    return rows.map((row) => toTaskView(row, now));
  }

  /** Open and overdue counts of one member (or the whole company). */
  async countOpen(
    companyId: string,
    assigneeId: string | null,
  ): Promise<{ tasksOpen: number; tasksOverdue: number }> {
    const qb = this.tasks
      .createQueryBuilder('task')
      .select('COUNT(task.id)', 'open')
      .addSelect(
        'SUM(CASE WHEN task.due_at IS NOT NULL AND task.due_at < :now THEN 1 ELSE 0 END)',
        'overdue',
      )
      .where('task.company_id = :companyId', { companyId })
      .andWhere('task.status = :open', { open: 'open' })
      .setParameter('now', new Date());
    if (assigneeId) qb.andWhere('task.assignee_member_id = :assigneeId', { assigneeId });

    const row = await qb.getRawOne<{ open: string | number | null; overdue: string | number | null }>();
    return {
      tasksOpen: Number(row?.open ?? 0) || 0,
      tasksOverdue: Number(row?.overdue ?? 0) || 0,
    };
  }

  /** `POST /tasks`. Assigning to someone else is admin/supervisor only. */
  async create(actor: TaskActor, input: CreateTaskInput): Promise<TaskView> {
    const id = await this.dataSource.transaction((manager) =>
      this.createWithin(manager, actor, input),
    );
    const task = await this.findView(actor.companyId, id);
    await this.announce(actor.companyId, task, 'created');
    return task;
  }

  /**
   * Same as `create`, inside the caller's transaction (start conversation).
   * The caller announces it after commit with `announceCreated`.
   */
  async createWithin(
    manager: EntityManager,
    actor: TaskActor,
    input: CreateTaskInput,
  ): Promise<string> {
    const assigneeMemberId = input.assigneeMemberId ?? actor.memberId;
    this.assertCanAssign(actor, assigneeMemberId);
    await this.assertActiveMember(manager, actor.companyId, assigneeMemberId);

    let customerId = input.customerId ?? null;
    if (input.conversationId) {
      const conversation = await manager.getRepository(Conversation).findOne({
        where: { id: input.conversationId, companyId: actor.companyId },
        select: { id: true, customerId: true },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      customerId ??= conversation.customerId;
    }
    if (input.customerId) {
      const exists = await manager.getRepository(Customer).exists({
        where: { id: input.customerId, companyId: actor.companyId },
        withDeleted: true,
      });
      if (!exists) throw new NotFoundException('Customer not found');
    }

    const repo = manager.getRepository(Task);
    const saved = await repo.save(
      repo.create({
        companyId: actor.companyId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'medium',
        status: 'open',
        dueAt: input.dueAt ?? null,
        assigneeMemberId,
        createdByMemberId: actor.memberId,
        conversationId: input.conversationId ?? null,
        customerId,
      }),
    );
    return saved.id;
  }

  /** Emits and invalidates for a task created through `createWithin`. */
  async announceCreated(companyId: string, taskId: string): Promise<void> {
    const task = await this.findView(companyId, taskId);
    await this.announce(companyId, task, 'created');
  }

  /** `PATCH /tasks/:id`. `null` clears; reassigning follows the create rule. */
  async update(actor: TaskActor, id: string, input: UpdateTaskInput): Promise<TaskView> {
    const task = await this.findEditable(actor, id);
    const previousAssignee = task.assigneeMemberId;

    if (input.assigneeMemberId && input.assigneeMemberId !== task.assigneeMemberId) {
      this.assertCanAssign(actor, input.assigneeMemberId);
      await this.assertActiveMember(this.dataSource.manager, actor.companyId, input.assigneeMemberId);
      task.assigneeMemberId = input.assigneeMemberId;
    }
    if (input.title !== undefined) task.title = input.title;
    if (input.description !== undefined) task.description = input.description;
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.dueAt !== undefined) task.dueAt = input.dueAt;
    if (input.status !== undefined && input.status !== task.status) {
      task.status = input.status;
      task.completedAt = input.status === 'done' ? new Date() : null;
    }

    await this.tasks.save(task);
    const view = await this.findView(actor.companyId, id);
    await this.announce(
      actor.companyId,
      view,
      input.status === 'done' ? 'completed' : 'updated',
      previousAssignee,
    );
    return view;
  }

  /** `POST /tasks/:id/complete`: shortcut for `status=done`. */
  complete(actor: TaskActor, id: string): Promise<TaskView> {
    return this.update(actor, id, { status: 'done' });
  }

  /** Every select of a full task view: members (even removed), conversation, customer. */
  private viewQuery(companyId: string): SelectQueryBuilder<Task> {
    return (
      this.tasks
        .createQueryBuilder('task')
        // Removed members, customers and conversations keep their names; the
        // task itself is filtered explicitly below.
        .withDeleted()
        .innerJoinAndSelect('task.assignee', 'assignee')
        .innerJoinAndSelect('assignee.user', 'assigneeUser')
        .leftJoinAndSelect('task.createdBy', 'createdBy')
        .leftJoinAndSelect('createdBy.user', 'createdByUser')
        .leftJoinAndSelect('task.conversation', 'conversation')
        .leftJoinAndSelect('conversation.channel', 'conversationChannel')
        .leftJoinAndSelect('conversation.customer', 'conversationCustomer')
        .leftJoinAndSelect('task.customer', 'customer')
        .where('task.company_id = :companyId', { companyId })
        .andWhere('task.deleted_at IS NULL')
    );
  }

  private async findView(companyId: string, id: string): Promise<TaskView> {
    const row = await this.viewQuery(companyId).andWhere('task.id = :id', { id }).getOne();
    if (!row) throw new NotFoundException('Task not found');
    return toTaskView(row, new Date());
  }

  /** The task, provided the actor may see it (agents: only their own; else 404). */
  private async findEditable(actor: TaskActor, id: string): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id, companyId: actor.companyId } });
    if (!task || (!isSupervisor(actor.role) && task.assigneeMemberId !== actor.memberId)) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private assertCanAssign(actor: TaskActor, assigneeMemberId: string): void {
    if (assigneeMemberId !== actor.memberId && !isSupervisor(actor.role)) {
      throw new ForbiddenException('Only admins and supervisors can assign tasks to others');
    }
  }

  private async assertActiveMember(
    manager: EntityManager,
    companyId: string,
    memberId: string,
  ): Promise<void> {
    const exists = await manager.getRepository(CompanyMember).exists({
      where: { id: memberId, companyId, status: 'active' },
    });
    if (!exists) throw new NotFoundException('Member not found');
  }

  /**
   * `task:changed` to the assignee (and a previous one) plus the company
   * room, in one emit so a socket in several rooms gets it once.
   */
  private async announce(
    companyId: string,
    task: TaskView,
    action: TaskChanged['action'],
    previousAssigneeId?: string,
  ): Promise<void> {
    await this.cache.invalidate(companyId);

    try {
      const memberIds = [...new Set([task.assignee.memberId, previousAssigneeId].filter(Boolean))];
      const members = await this.dataSource.getRepository(CompanyMember).find({
        where: memberIds.map((id) => ({ id: id as string })),
        withDeleted: true,
        select: { id: true, userId: true },
      });

      let target = this.gateway.server?.to(`company:${companyId}`);
      for (const member of members) target = target?.to(`user:${member.userId}`);

      const payload: TaskChanged = {
        taskId: task.id,
        action,
        assigneeMemberId: task.assignee.memberId,
        conversationId: task.conversation?.id ?? null,
      };
      target?.emit(TaskSocketEvent.Changed, payload);
    } catch (error) {
      this.logger.warn({ taskId: task.id, error: String(error) }, 'task:changed emit failed');
    }
  }
}

function ordered(qb: SelectQueryBuilder<Task>): SelectQueryBuilder<Task> {
  return qb
    .addSelect("CASE WHEN task.status = 'open' THEN 0 ELSE 1 END", 'task_status_rank')
    .addSelect('CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END', 'task_due_null')
    .orderBy('task_status_rank', 'ASC')
    .addOrderBy('task_due_null', 'ASC')
    .addOrderBy('task.due_at', 'ASC')
    .addOrderBy('task.created_at', 'ASC');
}

export function toTaskView(row: Task, now: Date): TaskView {
  const dueAt = row.dueAt ?? null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority,
    dueAt,
    overdue: row.status === 'open' && !!dueAt && new Date(dueAt).getTime() < now.getTime(),
    assignee: { memberId: row.assigneeMemberId, name: memberDisplayName(row.assignee?.user) },
    createdBy:
      row.createdBy && !row.createdBy.deletedAt
        ? { memberId: row.createdBy.id, name: memberDisplayName(row.createdBy.user) }
        : null,
    conversation: row.conversation
      ? {
          id: row.conversation.id,
          channelType: row.conversation.channel.type,
          customerName: row.conversation.customer?.displayName ?? null,
        }
      : null,
    customer: row.customer
      ? { id: row.customer.id, displayName: row.customer.displayName ?? null }
      : null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
