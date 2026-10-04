import { z } from 'zod';

/**
 * Chat contracts: enums, socket events and the payloads that cross the wire
 * (list endpoint + socket messages).
 *
 * Enums are `as const` objects (not TS enums) so the API can re-export them and
 * keep `ChatStatus.OPEN`-style usage working everywhere.
 */
const chatStatusValues = {
  OPEN: 'open',
  PENDING: 'pending',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
} as const;

export const ChatStatus = chatStatusValues;
export type ChatStatus =
  (typeof chatStatusValues)[keyof typeof chatStatusValues];
export const ChatStatusSchema = z.enum(
  Object.values(chatStatusValues) as [ChatStatus, ...ChatStatus[]],
);

const chatPriorityValues = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export const ChatPriority = chatPriorityValues;
export type ChatPriority =
  (typeof chatPriorityValues)[keyof typeof chatPriorityValues];
export const ChatPrioritySchema = z.enum(
  Object.values(chatPriorityValues) as [ChatPriority, ...ChatPriority[]],
);

const chatChannelValues = {
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  MESSENGER: 'messenger',
  SMS: 'sms',
  EMAIL: 'email',
} as const;

export const ChatChannel = chatChannelValues;
export type ChatChannel =
  (typeof chatChannelValues)[keyof typeof chatChannelValues];
export const ChatChannelSchema = z.enum(
  Object.values(chatChannelValues) as [ChatChannel, ...ChatChannel[]],
);

const reasonAssignmentValues = {
  TRANSFER: 'transfer',
  ESCALATION: 'escalation',
  MANUAL: 'manual',
  AUTO: 'auto',
} as const;

export const ReasonAssignment = reasonAssignmentValues;
export type ReasonAssignment =
  (typeof reasonAssignmentValues)[keyof typeof reasonAssignmentValues];
export const ReasonAssignmentSchema = z.enum(
  Object.values(reasonAssignmentValues) as [
    ReasonAssignment,
    ...ReasonAssignment[],
  ],
);

/** Socket event names (shared by the gateway and the frontend). */
export const ChatSocketEvent = {
  Join: 'chat:join',
  Joined: 'chat:joined',
  BroadcastMessage: 'chat:message:broadcast',
  ErrorMessage: 'chat:message:error',
  SendMessage: 'chat:message:send',
  ReceivedMessage: 'chat:message:received',
  UpdateSentimentIndicator: 'chat:sentiment:update',
  /** Evento que ya escucha el frontend (socket-provider) para notificaciones. */
  NewNotification: 'new-notification',
  ChatAssigned: 'chat:assigned',
  ChatUnassigned: 'chat:unassigned',
} as const;

export type ChatSocketEvent =
  (typeof ChatSocketEvent)[keyof typeof ChatSocketEvent];

/**
 * Message content union (matches the WhatsApp message content the API relays):
 * plain text or media/document payloads. Exported individually so consumers can
 * discriminate by `msg.type`.
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

export const ChatMessageContentSchema = z.union([
  WhatsAppTextContentSchema,
  WhatsAppDocumentContentSchema,
]);

export type WhatsAppTextContent = z.infer<typeof WhatsAppTextContentSchema>;
export type WhatsAppMediaContent = z.infer<typeof WhatsAppMediaContentSchema>;
export type WhatsAppDocumentContent = z.infer<
  typeof WhatsAppDocumentContentSchema
>;
export type ChatMessageContent = z.infer<typeof ChatMessageContentSchema>;

/** `GET /chats/list` item. */
export const ChatPreviewSchema = z.object({
  content: z.string().nullish(),
  datetime: z.coerce.date().nullish(),
});

export const ChatClientSchema = z.object({
  id: z.string(),
  username: z.string().nullish(),
  profile: z.string().nullish(),
  phone: z.string().nullish(),
});

export const ChatListItemSchema = z.object({
  id: z.string(),
  preview: ChatPreviewSchema,
  client: ChatClientSchema,
  status: ChatStatusSchema,
  createdAt: z.coerce.date(),
});

export type ChatPreview = z.infer<typeof ChatPreviewSchema>;
export type ChatClient = z.infer<typeof ChatClientSchema>;
export type ChatListItem = z.infer<typeof ChatListItemSchema>;
