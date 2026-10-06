import { z } from 'zod';

import {
  AttachmentStatusSchema,
  MessageSenderTypeSchema,
  MessageStatusSchema,
  MessageTypeSchema,
} from './message.contract';

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
} as const;

export type ConversationSocketEvent =
  (typeof ConversationSocketEvent)[keyof typeof ConversationSocketEvent];

/**
 * Message content union (matches the WhatsApp content the API relays):
 * plain text or media/document payloads. Discriminated by `msg.type`.
 */
export const WhatsAppTextContentSchema = z.object({
  body: z.string(),
  preview_url: z.boolean().optional(),
});

export const WhatsAppMediaContentSchema = z.object({
  link: z.string().optional(),
  id: z.string().optional(),
  caption: z.string().optional(),
});

export const WhatsAppDocumentContentSchema = WhatsAppMediaContentSchema.extend({
  filename: z.string().optional(),
});

export const MessageContentSchema = z.union([
  WhatsAppTextContentSchema,
  WhatsAppDocumentContentSchema,
]);

export type WhatsAppTextContent = z.infer<typeof WhatsAppTextContentSchema>;
export type WhatsAppMediaContent = z.infer<typeof WhatsAppMediaContentSchema>;
export type WhatsAppDocumentContent = z.infer<
  typeof WhatsAppDocumentContentSchema
>;
export type MessageContent = z.infer<typeof MessageContentSchema>;

/** `GET /conversations/list` item. */
export const ConversationCustomerSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  phone: z.string().nullish(),
});

export const ConversationListItemSchema = z.object({
  id: z.string(),
  preview: z.object({
    content: z.string().nullish(),
    datetime: z.coerce.date().nullish(),
  }),
  customer: ConversationCustomerSchema,
  status: ConversationStatusSchema,
  createdAt: z.coerce.date(),
});

export type ConversationCustomer = z.infer<typeof ConversationCustomerSchema>;
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

/** `POST /conversations/assign` payload. */
export const AssignConversationSchema = z.object({
  conversationId: z.string(),
  memberId: z.string(),
});

export type AssignConversationInput = z.infer<typeof AssignConversationSchema>;

/** `conversation:message:send` payload (frontend -> gateway). */
export const SendConversationMessageSchema = z.object({
  room: z.string(),
  /** Origin company, for multi-company auto-assignment. */
  companyId: z.string().optional(),
  to: z.string(),
  sender: z.object({
    id: z.string(),
    type: MessageSenderTypeSchema,
  }),
  msg: z.object({
    type: MessageTypeSchema,
    content: MessageContentSchema,
  }),
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
