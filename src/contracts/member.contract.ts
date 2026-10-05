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
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  role: MemberRoleSchema,
  status: MemberStatusSchema,
});

export type MemberSummary = z.infer<typeof MemberSummarySchema>;

/** `GET /company-members` item (staff of the active company). */
export const CompanyMemberResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  email: z.string().nullish(),
  role: MemberRoleSchema,
  status: MemberStatusSchema,
  acceptsAutoAssign: z.boolean(),
  maxOpenConversations: z.number().nullish(),
  joinedAt: z.coerce.date(),
});

export const CompanyMemberListQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CompanyMemberResponse = z.infer<
  typeof CompanyMemberResponseSchema
>;
export type CompanyMemberListQuery = z.infer<
  typeof CompanyMemberListQuerySchema
>;
