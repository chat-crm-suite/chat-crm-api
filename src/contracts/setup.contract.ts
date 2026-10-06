// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { CreateChannelSchema } from './channel.contract';

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
 * WhatsApp block of the wizard: creating a channel (credentials travel
 * plaintext over the wire and are encrypted before hitting the database).
 */
export const SetupWhatsAppSchema = CreateChannelSchema.omit({ type: true });

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
  channel: z
    .object({ id: z.string(), webhookVerifyToken: z.string().nullable() })
    .nullable(),
});

export type CreateSetupInput = z.infer<typeof CreateSetupSchema>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
