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

/**
 * `POST /setup/validate`: checks ONE wizard step server-side before the user
 * moves on, so a wrong token or bad Meta credentials surface on their own
 * step instead of at the final `POST /setup`. Steps after `token` also need
 * the setup token (else 403): the endpoint is public and the WhatsApp step
 * calls Meta.
 */
export const SETUP_STEPS = ['token', 'admin', 'company', 'whatsapp'] as const;
export const SetupStepSchema = z.enum(SETUP_STEPS);

export const ValidateSetupStepSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('token'), setupToken: z.string().optional() }),
  z.object({
    step: z.literal('admin'),
    setupToken: z.string().optional(),
    admin: SetupAdminSchema,
  }),
  z.object({
    step: z.literal('company'),
    setupToken: z.string().optional(),
    company: SetupCompanySchema,
  }),
  z.object({
    step: z.literal('whatsapp'),
    setupToken: z.string().optional(),
    whatsapp: SetupWhatsAppSchema,
  }),
]);

/** A problem tied to one field, by its `POST /setup` path (e.g. `whatsapp.accessToken`). */
export const SetupStepErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const SetupStepResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(SetupStepErrorSchema),
  /** Non-blocking notes, e.g. Meta could not be reached to verify. */
  warnings: z.array(z.string()),
  /** WhatsApp step only: what Meta reports for the verified number. */
  whatsapp: z
    .object({
      displayPhoneNumber: z.string().nullish(),
      verifiedName: z.string().nullish(),
    })
    .nullish(),
});

export type CreateSetupInput = z.infer<typeof CreateSetupSchema>;
export type SetupStep = z.infer<typeof SetupStepSchema>;
export type ValidateSetupStepInput = z.infer<typeof ValidateSetupStepSchema>;
export type SetupStepError = z.infer<typeof SetupStepErrorSchema>;
export type SetupStepResult = z.infer<typeof SetupStepResultSchema>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
