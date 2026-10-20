// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { CaseSchema } from './case.contract';
import { ChannelTypeSchema } from './channel.contract';
import {
  AttachmentStatusSchema,
  MessageStatusSchema,
  MessageTypeSchema,
  OutgoingMessageSchema,
} from './message.contract';
import { SendTemplateSchema } from './template.contract';

/**
 * Conversation contracts (v2): replaces `chats`. Status/priority/reason are
 * persisted as varchar(50) and validated by these schemas.
 */
export const CONVERSATION_STATUSES = [
  'open',
  'pending',
  'closed',
  'archived',
] as const;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const CONVERSATION_PRIORITIES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;
export const ConversationPrioritySchema = z.enum(CONVERSATION_PRIORITIES);
export type ConversationPriority = z.infer<typeof ConversationPrioritySchema>;

export const ASSIGNMENT_REASONS = [
  'auto',
  'claim',
  'manual',
  'transfer',
  'escalation',
  // The assignee left the company (member removed): back to the queue.
  'release',
] as const;
export const AssignmentReasonSchema = z.enum(ASSIGNMENT_REASONS);
export type AssignmentReason = z.infer<typeof AssignmentReasonSchema>;

/** Socket event names (shared by the gateway and the frontend). */
export const ConversationSocketEvent = {
  Join: 'conversation:join',
  Joined: 'conversation:joined',
  BroadcastMessage: 'conversation:message:broadcast',
  ErrorMessage: 'conversation:message:error',
  SendMessage: 'conversation:message:send',
  ReceivedMessage: 'conversation:message:received',
  MessageStatus: 'conversation:message:status',
  MessageAttachment: 'conversation:message:attachment',
  UpdateSentimentIndicator: 'conversation:sentiment:update',
  NewNotification: 'notification:new',
  ConversationAssigned: 'conversation:assigned',
  ConversationUnassigned: 'conversation:unassigned',
  /** Lifecycle change (resolve, pending, reopen): `ConversationStatusChangedSchema`. */
  StatusChanged: 'conversation:status:changed',
  /** A conversation was started from the CRM: `ConversationListItemSchema`. */
  Created: 'conversation:created',
} as const;

export type ConversationSocketEvent =
  (typeof ConversationSocketEvent)[keyof typeof ConversationSocketEvent];

/** `GET /conversations/list` item. */
export const ConversationCustomerSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  phone: z.string().nullish(),
});

export const ConversationChannelSchema = z.object({
  id: z.string(),
  type: ChannelTypeSchema,
  name: z.string(),
});

/** Active owner of a conversation (`company_members.id` + display name). */
export const ConversationAssigneeSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
});

/**
 * Derived "Transferido" marker: the active assignment has reason `transfer`
 * and the new owner has not sent an outbound message since `at`. Null once
 * the new owner replies.
 */
export const ConversationTransferSchema = z.object({
  fromMemberId: z.string().nullable(),
  fromName: z.string().nullable(),
  at: z.coerce.date(),
  note: z.string().nullable(),
});

export const ConversationListItemSchema = z.object({
  id: z.string(),
  preview: z.object({
    content: z.string().nullish(),
    datetime: z.coerce.date().nullish(),
    /** Last-message kind, so the list can label attachments without the thread. */
    type: MessageTypeSchema.nullish(),
  }),
  customer: ConversationCustomerSchema,
  /** Channel of the conversation: selects the composer's media capabilities. */
  channelType: ChannelTypeSchema,
  channel: ConversationChannelSchema,
  status: ConversationStatusSchema,
  priority: ConversationPrioritySchema.nullable(),
  assignee: ConversationAssigneeSchema.nullable(),
  transfer: ConversationTransferSchema.nullable(),
  lastInboundAt: z.coerce.date().nullable(),
  /**
   * `lastInboundAt + replyWindowMs` of the channel; null when the channel has
   * no reply window or the customer never wrote. In the past = free-form
   * replies are refused, only templates can be sent.
   */
  windowExpiresAt: z.coerce.date().nullable(),
  unread: z.number().int().min(0),
  createdAt: z.coerce.date(),
});

export type ConversationCustomer = z.infer<typeof ConversationCustomerSchema>;
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;
export type ConversationAssignee = z.infer<typeof ConversationAssigneeSchema>;
export type ConversationTransfer = z.infer<typeof ConversationTransferSchema>;
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

/**
 * `mine` = assigned to the caller; `all` = every conversation of the company
 * (admin/supervisor only, 403 for agents).
 */
export const LIST_SCOPES = ['mine', 'all'] as const;
export const ListScopeSchema = z.enum(LIST_SCOPES);
export type ListScope = z.infer<typeof ListScopeSchema>;

/**
 * `GET /conversations` query. Responds with `ConversationListItemSchema[]`,
 * newest `lastMessageAt` first. Without `status`, closed and archived
 * conversations are excluded. `GET /conversations/list`, `/unassigned` and
 * `/needs-response` answer the same item shape (the last two may add
 * `waitingSince`, stripped by the schema).
 */
export const ListConversationsQuerySchema = z.object({
  scope: ListScopeSchema.default('mine'),
  /** `company_members.id`; only honoured with `scope=all`. */
  assigneeId: z.string().optional(),
  status: ConversationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListConversationsQuery = z.infer<
  typeof ListConversationsQuerySchema
>;

/**
 * Body of `POST /conversations/:id/{resolve,pending,reopen,release}`. The
 * note is internal (never sent to the customer) and kept on the case or the
 * assignment row.
 */
export const ConversationNoteSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ConversationNoteInput = z.infer<typeof ConversationNoteSchema>;

/**
 * `POST /conversations/:id/transfer`: reassign to another member (reason
 * `transfer`). Owner, admin or supervisor; 409 when `memberId` already owns it.
 */
export const TransferConversationSchema = z.object({
  memberId: z.string(),
  note: z.string().trim().max(500).optional(),
});
export type TransferConversationInput = z.infer<
  typeof TransferConversationSchema
>;

/**
 * Response of every lifecycle endpoint: the resulting state, so the UI
 * updates without refetching the list.
 * - resolve: closes the open case, `status=closed`, releases the assignee.
 * - pending: `status=pending` (waiting on the customer), keeps the assignee.
 * - reopen: `status=open`, opens a case (reopen when within the window).
 * - release: back to the queue (`assignee=null`), status unchanged.
 * An inbound message always turns `pending`/`closed` back into `open`.
 */
export const ConversationLifecycleResultSchema = z.object({
  id: z.string(),
  status: ConversationStatusSchema,
  assignee: ConversationAssigneeSchema.nullable(),
  case: CaseSchema.nullable(),
});
export type ConversationLifecycleResult = z.infer<
  typeof ConversationLifecycleResultSchema
>;

/**
 * `PATCH /conversations/:id/priority` (owner, admin, supervisor): `null`
 * clears it. Responds with the updated `ConversationListItemSchema`.
 */
export const UpdateConversationPrioritySchema = z.object({
  priority: ConversationPrioritySchema.nullable(),
});
export type UpdateConversationPriorityInput = z.infer<
  typeof UpdateConversationPrioritySchema
>;

/** `conversation:status:changed` payload (conversation + company rooms). */
export const ConversationStatusChangedSchema = z.object({
  conversationId: z.string(),
  status: ConversationStatusSchema,
  previousStatus: ConversationStatusSchema,
  byMemberId: z.string().nullable(),
  at: z.coerce.date(),
});
export type ConversationStatusChanged = z.infer<
  typeof ConversationStatusChangedSchema
>;

/** `GET /conversations/assignments/:conversationId` item, newest first. */
export const ConversationAssignmentEntrySchema = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  reason: AssignmentReasonSchema,
  note: z.string().nullable(),
  assignedByMemberId: z.string().nullable(),
  assignedAt: z.coerce.date(),
  unassignedAt: z.coerce.date().nullable(),
});
export type ConversationAssignmentEntry = z.infer<
  typeof ConversationAssignmentEntrySchema
>;

/**
 * `POST /conversations/start`: open (or reuse) the conversation of a customer
 * on a channel, in one transaction. Optional parts:
 * - `assigneeMemberId`: assign it (someone else = admin/supervisor only;
 *   omitted = the caller).
 * - `template`: required when the channel's reply window is closed or the
 *   customer never wrote (409 `reply_window_closed` otherwise).
 * - `task`: create a follow-up task for the assignee linked to the chat.
 */
export const StartConversationSchema = z.object({
  customerId: z.string(),
  channelId: z.string(),
  assigneeMemberId: z.string().optional(),
  template: SendTemplateSchema.optional(),
  task: z
    .object({
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(2000).optional(),
      dueAt: z.coerce.date().optional(),
    })
    .optional(),
});
export type StartConversationInput = z.infer<typeof StartConversationSchema>;

export const StartConversationResultSchema = z.object({
  conversation: ConversationListItemSchema,
  /** False when an existing conversation of that customer + channel was reused. */
  created: z.boolean(),
  taskId: z.string().nullable(),
  messageId: z.string().nullable(),
});
export type StartConversationResult = z.infer<
  typeof StartConversationResultSchema
>;

/** Machine-readable `code` of 4xx answers from the conversation endpoints. */
export const ConversationErrorCode = {
  /** Free-form message outside the reply window: send a template instead. */
  ReplyWindowClosed: 'reply_window_closed',
  /** The channel type has no template support. */
  TemplatesUnsupported: 'templates_unsupported',
  /** Template not approved, hidden from agents, or from another channel. */
  TemplateUnavailable: 'template_unavailable',
  /** Missing value for a template variable. */
  TemplateParamsMissing: 'template_params_missing',
} as const;
export type ConversationErrorCode =
  (typeof ConversationErrorCode)[keyof typeof ConversationErrorCode];

/** `POST /conversations/assign` payload. */
export const AssignConversationSchema = z.object({
  conversationId: z.string(),
  memberId: z.string(),
});

export type AssignConversationInput = z.infer<typeof AssignConversationSchema>;

/**
 * `conversation:message:send` payload (frontend -> gateway). The sender and
 * the recipient are never part of it: the server takes the sender from the
 * socket session and the recipient from the conversation.
 */
export const SendConversationMessageSchema = z.object({
  room: z.string(),
  /** Company of the conversation; must match the one granted at join. */
  companyId: z.string().optional(),
  /**
   * Temp id generated by the front for optimistic UI + idempotent retries:
   * a double submit with the same id returns the existing row.
   */
  clientMessageId: z.string().min(1).max(64),
  msg: OutgoingMessageSchema,
});

export type SendConversationMessageInput = z.infer<
  typeof SendConversationMessageSchema
>;

/**
 * `conversation:message:status` payload (server -> client): a delivery tick
 * patch for one message, emitted to the conversation room and to the assignee.
 * Failures keep their error so the thread can stay failed without reloading.
 */
export const ConversationMessageStatusPatchSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  clientMessageId: z.string().nullish(),
  status: MessageStatusSchema,
  at: z.coerce.date(),
  errorCode: z.string().nullish(),
  errorMessage: z.string().nullish(),
});

export type ConversationMessageStatusPatch = z.infer<
  typeof ConversationMessageStatusPatchSchema
>;

/**
 * `conversation:message:attachment` payload (server -> client): the async
 * media enrichment finished for one attachment of a saved row. `ready` carries
 * the stored `url`; `failed` says the file is missing (the row itself stays).
 */
export const ConversationMessageAttachmentPatchSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  attachmentId: z.string(),
  status: AttachmentStatusSchema,
  url: z.string().nullish(),
  mimeType: z.string().nullish(),
  sizeBytes: z.number().nullish(),
  at: z.coerce.date(),
});

export type ConversationMessageAttachmentPatch = z.infer<
  typeof ConversationMessageAttachmentPatchSchema
>;

/**
 * Customer tone of one conversation: `GET /conversations/:id/sentiment`.
 *
 * `avgPos` / `avgNeu` / `avgNeg` are probabilities in [0, 1] averaged over the
 * completed sentiment analyses of the conversation; `totalMessages` counts
 * those analyzed messages. `dominant` is the highest average, with ties
 * resolved POS > NEG > NEU, so the indicator is deterministic. A conversation
 * without analyses stays neutral with zero averages.
 */
export const ConversationSentimentSchema = z.object({
  avgPos: z.number(),
  avgNeu: z.number(),
  avgNeg: z.number(),
  totalMessages: z.number().int().min(0),
  dominant: z.enum(['POS', 'NEU', 'NEG']),
});

export type ConversationSentiment = z.infer<typeof ConversationSentimentSchema>;
