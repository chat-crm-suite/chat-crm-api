// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { ChannelTypeSchema } from './channel.contract';
import {
  CONVERSATION_PRIORITIES,
  ConversationCustomerSchema,
  ListScopeSchema,
} from './conversation.contract';

/**
 * Tasks: manual work items stored in `tasks`, optionally linked to a
 * conversation and/or a customer. An agent sees and edits only the tasks
 * assigned to them; admin/supervisor see every task of the company and may
 * assign to anyone. Automatic alerts (new chat in the queue, needs a reply)
 * are NOT tasks: they are derived live as `WorkSignal`s.
 */
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_PRIORITIES = CONVERSATION_PRIORITIES;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskMemberRefSchema = z.object({
  memberId: z.string(),
  name: z.string(),
});
export type TaskMemberRef = z.infer<typeof TaskMemberRefSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: z.coerce.date().nullable(),
  /** `status=open` and `dueAt` in the past. */
  overdue: z.boolean(),
  assignee: TaskMemberRefSchema,
  /** Null when the creator left the company. */
  createdBy: TaskMemberRefSchema.nullable(),
  conversation: z
    .object({
      id: z.string(),
      channelType: ChannelTypeSchema,
      customerName: z.string().nullable(),
    })
    .nullable(),
  customer: z
    .object({ id: z.string(), displayName: z.string().nullable() })
    .nullable(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * `POST /tasks`, responds with `TaskSchema`. `assigneeMemberId` omitted =
 * the caller; another member = admin/supervisor only (403). With
 * `conversationId` and no `customerId`, the customer comes from the
 * conversation.
 */
export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  priority: TaskPrioritySchema.default('medium'),
  dueAt: z.coerce.date().optional(),
  assigneeMemberId: z.string().optional(),
  conversationId: z.string().optional(),
  customerId: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/**
 * `PATCH /tasks/:id`, responds with `TaskSchema`. `null` clears an optional
 * field. Reassigning follows the create rule. `status=done` stamps
 * `completedAt` (`POST /tasks/:id/complete` is the shortcut).
 */
export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  dueAt: z.coerce.date().nullable().optional(),
  assigneeMemberId: z.string().optional(),
  status: TaskStatusSchema.optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

/**
 * `GET /tasks` query, responds with `TaskSchema[]` ordered by status (open
 * first), then `dueAt` (nulls last), then `createdAt`. `scope=all` and
 * `assigneeId` are admin/supervisor only (403 for agents).
 */
export const ListTasksQuerySchema = z.object({
  scope: ListScopeSchema.default('mine'),
  assigneeId: z.string().optional(),
  status: TaskStatusSchema.optional(),
  conversationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

/**
 * Live alerts derived from conversations (never stored):
 * - `unassigned`: open/pending conversation without an owner (the queue).
 * - `needs_response`: last message is inbound and older than the threshold.
 * - `window_expiring`: reply window closes within `WINDOW_EXPIRING_MS`.
 */
export const WORK_SIGNAL_KINDS = [
  'unassigned',
  'needs_response',
  'window_expiring',
] as const;
export const WorkSignalKindSchema = z.enum(WORK_SIGNAL_KINDS);
export type WorkSignalKind = z.infer<typeof WorkSignalKindSchema>;

export const WINDOW_EXPIRING_MS = 2 * 60 * 60 * 1000;

export const WorkSignalSchema = z.object({
  kind: WorkSignalKindSchema,
  conversationId: z.string(),
  customer: ConversationCustomerSchema,
  channelType: ChannelTypeSchema,
  /** Waiting since (queue entry or last inbound message). */
  since: z.coerce.date(),
  windowExpiresAt: z.coerce.date().nullable(),
  /** Null for `unassigned`. */
  assignee: TaskMemberRefSchema.nullable(),
});
export type WorkSignal = z.infer<typeof WorkSignalSchema>;

/**
 * `GET /work-queue` query. Agent (`mine` only): own open tasks, the shared
 * queue and signals of their own conversations. Admin/supervisor with
 * `scope=all`: everything, optionally narrowed to one `assigneeId`.
 */
export const WorkQueueQuerySchema = z.object({
  scope: ListScopeSchema.default('mine'),
  assigneeId: z.string().optional(),
});
export type WorkQueueQuery = z.infer<typeof WorkQueueQuerySchema>;

export const WorkQueueCountsSchema = z.object({
  tasksOpen: z.number().int().min(0),
  tasksOverdue: z.number().int().min(0),
  unassigned: z.number().int().min(0),
  needsResponse: z.number().int().min(0),
  windowExpiring: z.number().int().min(0),
});
export type WorkQueueCounts = z.infer<typeof WorkQueueCountsSchema>;

/** Empty database = empty arrays and zero counts, never 404. */
export const WorkQueueResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  signals: z.array(WorkSignalSchema),
  counts: WorkQueueCountsSchema,
  generatedAt: z.coerce.date(),
});
export type WorkQueueResponse = z.infer<typeof WorkQueueResponseSchema>;

export const TaskSocketEvent = {
  /** Sent to the assignee's user room and the company room. */
  Changed: 'task:changed',
} as const;

export const TaskChangedSchema = z.object({
  taskId: z.string(),
  action: z.enum(['created', 'updated', 'completed', 'deleted']),
  assigneeMemberId: z.string(),
  conversationId: z.string().nullable(),
});
export type TaskChanged = z.infer<typeof TaskChangedSchema>;
