import { z } from 'zod';

import { WhatsAppApiVersionSchema } from './whatsapp-config.contract';

/**
 * First-run setup contracts (public wizard endpoints).
 */
export const SetupAdminSchema = z.object({
  username: z.string().min(3).max(255),
  password: z.string().min(8),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  email: z.email().max(255).optional(),
  phoneNumber: z.string().max(50).optional(),
});

export const SetupCompanySchema = z.object({
  name: z.string().max(255),
  email: z.email().max(255).optional(),
  phoneNumber: z.string().max(50).optional(),
  address: z.string().optional(),
});

/**
 * WhatsApp block of the wizard. Unlike `CreateWhatsAppConfigSchema`,
 * `businessId` may be omitted (the setup form can leave it empty).
 */
export const SetupWhatsAppSchema = z.object({
  businessId: z.string().optional(),
  accessToken: z.string(),
  phoneNumberId: z.string(),
  webhookUrl: z.string(),
  apiVersion: WhatsAppApiVersionSchema.optional(),
  apiBaseUrl: z.string().optional(),
});

export const CreateSetupSchema = z.object({
  setupToken: z.string().optional(),
  admin: SetupAdminSchema,
  company: SetupCompanySchema,
  whatsapp: SetupWhatsAppSchema.optional(),
});

export const SetupStatusSchema = z.object({
  initialized: z.boolean(),
  hasAdmin: z.boolean(),
  hasCompany: z.boolean(),
  hasWhatsapp: z.boolean(),
  hasUsers: z.boolean(),
  requiresSetupToken: z.boolean(),
});

export const SetupResultSchema = z.object({
  user: z.object({ id: z.string(), username: z.string() }),
  company: z.object({ id: z.string(), name: z.string() }),
  whatsapp: z
    .object({ id: z.string(), webhookVerifyToken: z.string() })
    .nullable(),
});

export type CreateSetupInput = z.infer<typeof CreateSetupSchema>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
