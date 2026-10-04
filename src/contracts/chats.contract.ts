import { z } from 'zod';

/**
 * Chat request contracts (currently only manual assignment; the remaining
 * chat DTOs are pending migration).
 */
export const ChatAssignSchema = z.object({
  chatId: z.uuid(),
  agentId: z.uuid(),
});

export type ChatAssignInput = z.infer<typeof ChatAssignSchema>;
