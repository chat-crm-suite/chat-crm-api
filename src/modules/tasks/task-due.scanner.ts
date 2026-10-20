// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import { NotificationDispatcher } from '../notifications/notification.dispatcher';
import { Task } from './entities/task.entity';

export const TASK_DUE_QUEUE = 'task-due';
const SCAN_JOB = 'scan';
export const TASK_DUE_SCAN_EVERY_MS = 5 * 60_000;
/** "Por vencer" when the deadline is this close. */
export const DUE_SOON_MS = 30 * 60_000;
/**
 * "Vencida" only for deadlines passed this recently: tolerates a few missed
 * scans, and a deploy never floods people with tasks that expired long ago.
 */
export const OVERDUE_LOOKBACK_MS = 15 * 60_000;
/** Each notice once per task and deadline (a new deadline notifies again). */
const DUE_DEDUPE_TTL_MS = 3 * 24 * 60 * 60_000;

type DueKind = 'soon' | 'overdue';

/**
 * Finds open tasks about to expire or just expired and notifies their
 * assignee (`task_due`). Runs as a BullMQ job scheduler, so with several API
 * processes the scan still runs once per tick; the per-deadline dedupe makes
 * overlapping windows harmless.
 */
@Injectable()
export class TaskDueScanner {
  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly notifications: NotificationDispatcher,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskDueScanner.name);
  }

  async scan(now = new Date()): Promise<number> {
    const due = await this.tasks
      .createQueryBuilder('task')
      .where('task.status = :open', { open: 'open' })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.due_at > :from AND task.due_at <= :to', {
        from: new Date(now.getTime() - OVERDUE_LOOKBACK_MS),
        to: new Date(now.getTime() + DUE_SOON_MS),
      })
      .getMany();

    for (const task of due) {
      const dueAt = new Date(task.dueAt as Date);
      await this.notify(task, dueAt.getTime() > now.getTime() ? 'soon' : 'overdue', dueAt, now);
    }

    return due.length;
  }

  private notify(task: Task, kind: DueKind, dueAt: Date, now: Date): Promise<void> {
    const minutes = Math.max(1, Math.round((dueAt.getTime() - now.getTime()) / 60_000));

    return this.notifications.notify({
      companyId: task.companyId,
      type: 'task_due',
      audience: { memberIds: [task.assigneeMemberId] },
      title: kind === 'soon' ? 'Tarea por vencer' : 'Tarea vencida',
      body: kind === 'soon' ? `${task.title} · vence en ${minutes} min` : task.title,
      severity: kind === 'soon' ? 'warning' : 'critical',
      data: {
        taskId: task.id,
        ...(task.conversationId ? { conversationId: task.conversationId } : {}),
      },
      dedupeKey: `task:${task.id}:${kind}:${dueAt.toISOString()}`,
      dedupeTtlMs: DUE_DEDUPE_TTL_MS,
    });
  }
}

@Processor(TASK_DUE_QUEUE)
export class TaskDueProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly scanner: TaskDueScanner,
    @InjectQueue(TASK_DUE_QUEUE) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(TaskDueProcessor.name);
  }

  /** Idempotent: the scheduler id is fixed, every boot just upserts it. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'task-due-scan',
        { every: TASK_DUE_SCAN_EVERY_MS },
        { name: SCAN_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
      );
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Task due scheduler unavailable');
    }
  }

  async process(): Promise<number> {
    return this.scanner.scan();
  }
}
