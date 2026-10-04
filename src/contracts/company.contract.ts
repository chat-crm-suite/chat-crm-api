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
 * Automatic assignment settings (Q18). Admins/managers only.
 */
export const UpdateAssignmentSettingsSchema = z.object({
  autoAssignEnabled: z.boolean().optional(),
  autoAssignMaxChats: z.number().int().min(1).optional(),
  autoAssignSticky: z.boolean().optional(),
  autoAssignNotifySupervisors: z.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
export type UpdateAssignmentSettingsInput = z.infer<
  typeof UpdateAssignmentSettingsSchema
>;
