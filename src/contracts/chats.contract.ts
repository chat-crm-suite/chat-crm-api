import { z } from 'zod';

import {
  ChatChannelSchema,
  ChatPrioritySchema,
  ChatStatusSchema,
} from './chat.contract';

/**
 * Chat request contracts (assignment + create/update).
 */
export const ChatAssignSchema = z.object({
  chatId: z.uuid(),
  agentId: z.uuid(),
});

export const CreateChatSchema = z.object({
  clientId: z.uuid(),
  status: ChatStatusSchema.optional(),
  priority: ChatPrioritySchema.optional(),
  channel: ChatChannelSchema.optional(),
});

export const UpdateChatSchema = z.object({
  status: ChatStatusSchema.optional(),
  priority: ChatPrioritySchema.optional(),
  channel: ChatChannelSchema.optional(),
});

export type ChatAssignInput = z.infer<typeof ChatAssignSchema>;
export type CreateChatInput = z.infer<typeof CreateChatSchema>;
export type UpdateChatInput = z.infer<typeof UpdateChatSchema>;
