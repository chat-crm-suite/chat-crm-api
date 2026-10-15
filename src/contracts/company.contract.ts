// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { MemberCreateOutcomeSchema } from './member.contract';
import { paginatedSchema, TableQueryBaseSchema } from './pagination.contract';

/**
 * Company contracts (creation + per-company automation settings).
 */
export const CompanyStatusSchema = z.enum(['active', 'inactive', 'suspended']);

export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

export const CreateCompanySchema = z.object({
  name: z.string().max(255),
  email: z.email().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().optional(),
  status: CompanyStatusSchema.optional(),
});

export const UpdateCompanySchema = CreateCompanySchema.partial();

/**
 * Automatic assignment settings. Admins/supervisors only.
 */
export const UpdateAssignmentSettingsSchema = z.object({
  autoAssignEnabled: z.boolean().optional(),
  autoAssignMaxOpen: z.number().int().min(1).optional(),
  autoAssignSticky: z.boolean().optional(),
  autoAssignNotifySupervisors: z.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
export type UpdateAssignmentSettingsInput = z.infer<
  typeof UpdateAssignmentSettingsSchema
>;

/** `GET /company/me` (active company). */
export const CompanyProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  address: z.string().nullish(),
  timezone: z.string(),
  status: CompanyStatusSchema,
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

/** `PATCH /company/me` (admin of the active company). */
export const UpdateCompanyProfileSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.email().max(255).optional(),
  phoneNumber: z.string().max(20).optional(),
  address: z.string().max(1000).optional(),
  timezone: z.string().max(64).optional(),
});
export type UpdateCompanyProfileInput = z.infer<
  typeof UpdateCompanyProfileSchema
>;

/** `GET /company/me/assignment-settings` (same fields as the update). */
export const AssignmentSettingsSchema = z.object({
  autoAssignEnabled: z.boolean(),
  autoAssignMaxOpen: z.number().int(),
  autoAssignSticky: z.boolean(),
  autoAssignNotifySupervisors: z.boolean(),
});
export type AssignmentSettings = z.infer<typeof AssignmentSettingsSchema>;

/**
 * Platform console (superadmin). Requires `users.is_platform_admin` AND an
 * unlock with `PLATFORM_CONSOLE_PASSWORD`; without that env var the whole
 * `/platform/*` surface answers 404.
 */
export const PlatformUnlockSchema = z.object({
  password: z.string().min(1).max(256),
});
export type PlatformUnlockInput = z.infer<typeof PlatformUnlockSchema>;

/** `GET /platform/status`, `POST /platform/unlock|lock` response. */
export const PlatformStatusSchema = z.object({
  /** Env password configured (console available at all). */
  enabled: z.boolean(),
  unlocked: z.boolean(),
  expiresAt: z.coerce.date().nullish(),
  /** Seconds until another unlock attempt is allowed (rate limit). */
  retryAfterSec: z.number().int().nullish(),
});
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>;

export const PlatformCompanyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  address: z.string().nullish(),
  timezone: z.string(),
  status: CompanyStatusSchema,
  membersCount: z.number().int().min(0),
  customersCount: z.number().int().min(0),
  channelsCount: z.number().int().min(0),
  createdAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
});
export type PlatformCompanyRow = z.infer<typeof PlatformCompanyRowSchema>;

/** `POST /platform/companies/table`. */
export const PlatformCompanyQuerySchema = TableQueryBaseSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.array(CompanyStatusSchema).optional(),
  includeDeleted: z.boolean().default(false),
});
export type PlatformCompanyQuery = z.infer<typeof PlatformCompanyQuerySchema>;

export const PlatformCompanyTableResponseSchema = paginatedSchema(
  PlatformCompanyRowSchema,
);
export type PlatformCompanyTableResponse = z.infer<
  typeof PlatformCompanyTableResponseSchema
>;

/** `POST /platform/companies`; the first admin links by email or is created. */
export const PlatformCreateCompanySchema = UpdateCompanyProfileSchema.extend({
  name: z.string().trim().min(1).max(255),
  admin: z
    .object({
      email: z.email().max(255),
      username: z
        .string()
        .min(3)
        .max(100)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .optional(),
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
    })
    .optional(),
});
export type PlatformCreateCompanyInput = z.infer<
  typeof PlatformCreateCompanySchema
>;

export const PlatformCreateCompanyResultSchema = z.object({
  company: PlatformCompanyRowSchema,
  adminOutcome: MemberCreateOutcomeSchema.nullish(),
  /** Only when the first admin account was created; shown once. */
  initialPassword: z.string().optional(),
});
export type PlatformCreateCompanyResult = z.infer<
  typeof PlatformCreateCompanyResultSchema
>;

/** `PATCH /platform/companies/:id`. */
export const PlatformUpdateCompanySchema = UpdateCompanyProfileSchema.extend({
  status: CompanyStatusSchema.optional(),
});
export type PlatformUpdateCompanyInput = z.infer<
  typeof PlatformUpdateCompanySchema
>;

/** `DELETE /platform/companies/:id` (soft delete). */
export const PlatformDeleteCompanyResultSchema = z.object({
  /** Members that lost access (sessions revoked). */
  affectedMembers: z.number().int().min(0),
});
export type PlatformDeleteCompanyResult = z.infer<
  typeof PlatformDeleteCompanyResultSchema
>;
