import { z } from 'zod';

/**
 * Channel contracts (v2): a company talks to customers through N channels
 * (WhatsApp is the first provider). Replaces `whatsapp_configs`.
 */
export const WHATSAPP_API_VERSIONS = [
  'v18.0',
  'v19.0',
  'v20.0',
  'v21.0',
  'v22.0',
  'v23.0',
] as const;

export const WhatsAppApiVersionSchema = z.enum(WHATSAPP_API_VERSIONS);
export type WhatsAppApiVersion = z.infer<typeof WhatsAppApiVersionSchema>;

export const DEFAULT_WHATSAPP_API_VERSION: WhatsAppApiVersion = 'v22.0';
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

/** Payload accepted by `POST /channels` (WhatsApp is the only provider today). */
export const CreateChannelSchema = z.object({
  type: ChannelTypeSchema.default('whatsapp'),
  name: z.string().max(100).optional(),
  externalAccountId: z.string().max(100),
  displayAddress: z.string().max(100).optional(),
  businessId: z.string().optional(),
  accessToken: z.string(),
  webhookUrl: z.string().optional(),
  apiVersion: WhatsAppApiVersionSchema.optional(),
  apiBaseUrl: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
});

export const UpdateChannelSchema = CreateChannelSchema.partial().extend({
  status: ChannelStatusSchema.optional(),
});

/**
 * Sanitized shape returned by the channels endpoints: never includes the
 * access token (only whether credentials are present).
 */
export const ChannelResponseSchema = z.object({
  id: z.string(),
  type: ChannelTypeSchema,
  name: z.string(),
  externalAccountId: z.string(),
  displayAddress: z.string().nullish(),
  status: ChannelStatusSchema,
  webhookVerifyToken: z.string().nullish(),
  apiVersion: z.string().nullish(),
  apiBaseUrl: z.string().nullish(),
  webhookUrl: z.string().nullish(),
  businessId: z.string().nullish(),
  hasCredentials: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;
export type UpdateChannelInput = z.infer<typeof UpdateChannelSchema>;
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
