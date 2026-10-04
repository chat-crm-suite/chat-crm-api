import { z } from 'zod';

/**
 * Channel contracts (v2): a company talks to customers through N channels
 * (WhatsApp is the first provider). Replaces `whatsapp_configs`.
 */
export const CHANNEL_TYPES = [
  'whatsapp',
  'telegram',
  'messenger',
  'instagram',
  'email',
  'sms',
  'webchat',
] as const;
export const ChannelTypeSchema = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const CHANNEL_STATUSES = ['active', 'inactive', 'error'] as const;
export const ChannelStatusSchema = z.enum(CHANNEL_STATUSES);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

/** Plaintext keys stored (encrypted) in `channels.credentials` for WhatsApp. */
export const WhatsAppCredentialsSchema = z.object({
  accessToken: z.string(),
  businessId: z.string().optional(),
});
export type WhatsAppCredentials = z.infer<typeof WhatsAppCredentialsSchema>;

/** Non-secret settings stored in `channels.settings` for WhatsApp. */
export const WhatsAppChannelSettingsSchema = z.object({
  apiVersion: z.string().default('v22.0'),
  apiBaseUrl: z.string().default('https://graph.facebook.com'),
  webhookUrl: z.string().optional(),
});
export type WhatsAppChannelSettings = z.infer<
  typeof WhatsAppChannelSettingsSchema
>;
