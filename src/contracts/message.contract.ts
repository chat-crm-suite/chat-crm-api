import { z } from 'zod';

import { ChatMessageContentSchema } from './chat.contract';

/**
 * Message contracts: enums, the broadcast payload the API emits/returns and
 * the socket send payload.
 */
const messageTypeValues = {
  TEXT: 'text',
  IMAGE: 'image',
  DOCUMENT: 'document',
  // FILE/AUDIO/VIDEO are not persisted yet (see message.enum.ts history).
} as const;

export const MessageType = messageTypeValues;
export type MessageType =
  (typeof messageTypeValues)[keyof typeof messageTypeValues];
export const MessageTypeSchema = z.enum(
  Object.values(messageTypeValues) as [MessageType, ...MessageType[]],
);

const messageSenderTypeValues = {
  AGENT: 'agent',
  CLIENT: 'client',
  SYSTEM: 'system',
} as const;

export const MessageSenderType = messageSenderTypeValues;
export type MessageSenderType =
  (typeof messageSenderTypeValues)[keyof typeof messageSenderTypeValues];
export const MessageSenderTypeSchema = z.enum(
  Object.values(messageSenderTypeValues) as [
    MessageSenderType,
    ...MessageSenderType[],
  ],
);

const messageStatusValues = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  RECEIVED: 'received',
  READ: 'read',
  FAILED: 'failed',
} as const;

export const MessageStatus = messageStatusValues;
export type MessageStatus =
  (typeof messageStatusValues)[keyof typeof messageStatusValues];
export const MessageStatusSchema = z.enum(
  Object.values(messageStatusValues) as [MessageStatus, ...MessageStatus[]],
);

const messageDirectionValues = {
  IN: 'in',
  OUT: 'out',
} as const;

export const MessageDirection = messageDirectionValues;
export type MessageDirection =
  (typeof messageDirectionValues)[keyof typeof messageDirectionValues];
export const MessageDirectionSchema = z.enum(
  Object.values(messageDirectionValues) as [MessageDirection, ...MessageDirection[]],
);

/**
 * `GET /chats/:id/messages` item + `chat:message:broadcast` payload.
 */
export const BroadcastMessageSchema = z.object({
  id: z.string(),
  chatId: z.string().optional(),
  status: MessageStatusSchema,
  timestamp: z.coerce.date(),
  sender: z.object({
    id: z.string(),
    type: MessageSenderTypeSchema,
  }),
  msg: z.object({
    type: MessageTypeSchema,
    mediaUrl: z.string().optional(),
    content: ChatMessageContentSchema,
  }),
});

/**
 * `chat:message:send` payload (frontend -> gateway).
 */
export const SendChatMessageSchema = z.object({
  room: z.string(),
  /** Empresa de origen, para asignación automática multi-empresa (Q4/Q15). */
  companyId: z.string().optional(),
  to: z.string(),
  sender: z.object({
    id: z.string(),
    type: MessageSenderTypeSchema,
  }),
  msg: z.object({
    type: MessageTypeSchema,
    content: ChatMessageContentSchema,
  }),
});

export type BroadcastMessage = z.infer<typeof BroadcastMessageSchema>;
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>;
