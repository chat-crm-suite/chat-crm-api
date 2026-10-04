import { z } from 'zod';

/**
 * Company member contracts (v2).
 *
 * Single source of truth for the per-company role (`company_members.role`)
 * and status. `users` no longer carries a role: the business role always
 * applies in the context of a company.
 */
export const MEMBER_ROLES = ['admin', 'supervisor', 'agent'] as const;
export const MemberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MEMBER_STATUSES = ['active', 'inactive', 'suspended'] as const;
export const MemberStatusSchema = z.enum(MEMBER_STATUSES);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

/** Membership summary returned by `GET /auth/me` for company switching/UI gating. */
export const MemberSummarySchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  role: MemberRoleSchema,
  status: MemberStatusSchema,
});

export type MemberSummary = z.infer<typeof MemberSummarySchema>;
