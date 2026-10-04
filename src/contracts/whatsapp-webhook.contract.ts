import { z } from 'zod';

/**
 * WhatsApp webhook verification query (public endpoint used by Meta).
 */
export const WebhookQuerySchema = z.object({
  'hub.mode': z.string(),
  'hub.challenge': z.string(),
  'hub.verify_token': z.string(),
});

export type WebhookQueryInput = z.infer<typeof WebhookQuerySchema>;
