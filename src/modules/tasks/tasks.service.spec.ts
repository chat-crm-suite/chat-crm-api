// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

import { inboxSeed } from '@helpers/inbox-seed';
import { inlineNotifications } from '@helpers/inline-notifications';
import { MemoryRedis } from '@helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from '@helpers/test-database.helper';
import { TaskSchema, WorkQueueResponseSchema } from '../../contracts/index';
import type { CompanyMember } from '../company-members/entities/company-member.entity';
import { ConversationAssignmentService } from '../conversations/assignment/conversation-assignment.service';
import { Notification } from '../notifications/entities/notification.entity';
import { Task } from './entities/task.entity';
import { TasksService, type TaskActor } from './tasks.service';
import { WorkQueueCache } from './work-queue.cache';
import { WorkQueueService } from './work-queue.service';

jest.setTimeout(60_000);

const logger = { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

/** Task permissions per role, ordering, events and the work queue on SQLite. */
describe('TasksService + WorkQueueService', () => {
  let dataSource: DataSource;
  let seed: ReturnType<typeof inboxSeed>;
  let tasks: TasksService;
  let workQueue: WorkQueueService;
  const redis = new MemoryRedis();
  const emits: { rooms: string[]; event: string; payload: unknown }[] = [];
  const operator = (rooms: string[]) => ({
    to: (room: string | string[]) => operator([...rooms, ...[room].flat()]),
    emit: (event: string, payload: unknown) => emits.push({ rooms, event, payload }),
  });
  const gateway = { server: { to: (room: string | string[]) => operator([room].flat()) } };

  beforeAll(async () => {
    dataSource = new DataSource(getTestSQLiteConfig(getSQLiteEntities()) as DataSourceOptions);
    await dataSource.initialize();
    seed = inboxSeed(dataSource);

    const cache = new WorkQueueCache(redis as never, logger as never);
    tasks = new TasksService(
      dataSource.getRepository(Task),
      dataSource,
      gateway as never,
      cache,
      logger as never,
      inlineNotifications(dataSource, null, logger as never).dispatcher,
    );
    workQueue = new WorkQueueService(
      dataSource,
      tasks,
      new ConversationAssignmentService(dataSource, logger as never),
      cache,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    emits.length = 0;
  });

  const actor = (member: CompanyMember): TaskActor => ({
    companyId: member.companyId,
    memberId: member.id,
    role: member.role,
  });

  it('answers an empty work queue with zero counts', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);

    const queue = WorkQueueResponseSchema.parse(await workQueue.get(actor(agent), { scope: 'mine' }));
    expect(queue).toMatchObject({
      tasks: [],
      signals: [],
      counts: { tasksOpen: 0, tasksOverdue: 0, unassigned: 0, needsResponse: 0, windowExpiring: 0 },
    });
  });

  it('refuses the team views to agents', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);

    await expect(workQueue.get(actor(agent), { scope: 'all' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(tasks.list(actor(agent), { scope: 'all', limit: 10 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets agents create only their own tasks and supervisors assign to anyone', async () => {
    const company = await seed.company();
    const agent = await seed.member(company, 'agent', 'Ana');
    const peer = await seed.member(company);
    const supervisor = await seed.member(company, 'supervisor');

    await expect(
      tasks.create(actor(agent), { title: 'x', priority: 'medium', assigneeMemberId: peer.id }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const assigned = TaskSchema.parse(
      await tasks.create(actor(supervisor), {
        title: 'Seguimiento',
        priority: 'high',
        assigneeMemberId: agent.id,
      }),
    );
    expect(assigned).toMatchObject({
      assignee: { memberId: agent.id, name: 'Ana' },
      createdBy: { memberId: supervisor.id },
      conversation: null,
      customer: null,
    });
    // Staff + the assignee: other agents never hear about it.
    expect(emits.at(-1)).toMatchObject({
      rooms: [
        `company:${company.id}:role:admin`,
        `company:${company.id}:role:supervisor`,
        `user:${agent.userId}`,
      ],
      event: 'task:changed',
      payload: { taskId: assigned.id, action: 'created', assigneeMemberId: agent.id },
    });

    // The assignee got one notice; the supervisor who assigned it none.
    const notices = await dataSource.getRepository(Notification).find();
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'task_assigned',
        recipientMemberId: agent.id,
        body: expect.stringMatching(/^Seguimiento · de /) as string,
        data: { taskId: assigned.id },
      }),
    ]);

    // Reassigning notifies the new assignee; editing a field does not.
    const other = await seed.member(company);
    await tasks.update(actor(supervisor), assigned.id, { assigneeMemberId: other.id });
    await tasks.update(actor(supervisor), assigned.id, { title: 'Seguimiento VIP' });
    expect(
      (await dataSource.getRepository(Notification).find()).map((n) => n.recipientMemberId),
    ).toEqual(expect.arrayContaining([agent.id, other.id]));
    expect(await dataSource.getRepository(Notification).count()).toBe(2);
    await tasks.update(actor(supervisor), assigned.id, { assigneeMemberId: agent.id });

    await expect(tasks.update(actor(peer), assigned.id, { title: 'mine?' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      tasks.create(actor(supervisor), { title: 'x', priority: 'medium', assigneeMemberId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('orders open tasks first, by due date with nulls last, and stamps completion', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);
    const later = await tasks.create(actor(agent), {
      title: 'later',
      priority: 'medium',
      dueAt: new Date(Date.now() + 86_400_000),
    });
    const undated = await tasks.create(actor(agent), { title: 'undated', priority: 'medium' });
    const overdue = await tasks.create(actor(agent), {
      title: 'overdue',
      priority: 'medium',
      dueAt: new Date(Date.now() - 60_000),
    });
    const done = await tasks.complete(actor(agent), undated.id);
    expect(done).toMatchObject({ status: 'done', overdue: false });
    expect(done.completedAt).not.toBeNull();

    const list = await tasks.list(actor(agent), { scope: 'mine', limit: 10 });
    expect(list.map((task) => task.title)).toEqual(['overdue', 'later', 'undated']);
    expect(list[0].overdue).toBe(true);

    const reopened = await tasks.update(actor(agent), undated.id, { status: 'open', dueAt: null });
    expect(reopened.completedAt).toBeNull();

    const queue = await workQueue.get(actor(agent), { scope: 'mine' });
    expect(queue.tasks.map((task) => task.id)).toEqual([overdue.id, later.id, undated.id]);
    expect(queue.counts).toMatchObject({ tasksOpen: 3, tasksOverdue: 1 });
  });

  it('caches the counts and drops them when a task changes', async () => {
    const company = await seed.company();
    const agent = await seed.member(company);
    await seed.conversation(company);

    expect((await workQueue.get(actor(agent), { scope: 'mine' })).counts.unassigned).toBe(1);
    // A second queued conversation is not counted until the cache moves.
    await seed.conversation(company);
    expect((await workQueue.get(actor(agent), { scope: 'mine' })).counts.unassigned).toBe(1);

    await tasks.create(actor(agent), { title: 'bump', priority: 'low' });
    const fresh = await workQueue.get(actor(agent), { scope: 'mine' });
    expect(fresh.counts).toMatchObject({ unassigned: 2, tasksOpen: 1 });
    expect(fresh.signals.filter((signal) => signal.kind === 'unassigned')).toHaveLength(2);
  });
});
