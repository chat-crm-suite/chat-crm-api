// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

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
