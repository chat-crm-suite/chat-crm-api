import { z } from 'zod';

import { MessageSenderTypeSchema, MessageTypeSchema } from './message.contract';

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
