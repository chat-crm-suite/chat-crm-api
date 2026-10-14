// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import {
  paginatedSchema,
  PaginationMetaSchema,
  TableQueryBaseSchema,
} from './pagination.contract';
import { PresenceSchema, PresenceStateSchema } from './presence.contract';

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

/**
 * Team management (Equipo). `company_members` rows of the active company with
 * the user identity, live load and presence. Soft-deleted members never
 * appear; removing one releases its open conversations to the queue.
 */
export const TeamMemberRowSchema = CompanyMemberResponseSchema.extend({
  avatarUrl: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  lastLoginAt: z.coerce.date().nullish(),
  /** Conversations in `open`/`pending` currently assigned to the member. */
  openConversations: z.number().int().min(0),
  /** Effective capacity: member override, else the company setting. */
  capacity: z.number().int().nullable(),
  /** Overlaid live (never cached). */
  presence: PresenceSchema,
});
export type TeamMemberRow = z.infer<typeof TeamMemberRowSchema>;

/** `POST /company-members/table` body. */
export const TeamTableQuerySchema = TableQueryBaseSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.array(MemberRoleSchema).optional(),
  status: z.array(MemberStatusSchema).optional(),
  presence: z.array(PresenceStateSchema).optional(),
});
export type TeamTableQuery = z.infer<typeof TeamTableQuerySchema>;

/** Header chips; every key is present (zeros on an empty company). */
export const TeamCountsSchema = z.object({
  byRole: z.object({
    admin: z.number().int(),
    supervisor: z.number().int(),
    agent: z.number().int(),
  }),
  byPresence: z.object({
    available: z.number().int(),
    away: z.number().int(),
    offline: z.number().int(),
  }),
});
export type TeamCounts = z.infer<typeof TeamCountsSchema>;

export const TeamTableResponseSchema = paginatedSchema(
  TeamMemberRowSchema,
).extend({
  meta: PaginationMetaSchema.extend({ counts: TeamCountsSchema }),
});
export type TeamTableResponse = z.infer<typeof TeamTableResponseSchema>;

export const MEMBER_USERNAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `POST /company-members`. Links an existing account when `email` matches. */
export const CreateMemberSchema = z.object({
  email: z.email().max(255),
  role: MemberRoleSchema,
  username: z.string().min(3).max(100).regex(MEMBER_USERNAME_REGEX).optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phoneNumber: z.string().max(20).optional(),
  acceptsAutoAssign: z.boolean().optional(),
  maxOpenConversations: z.number().int().min(1).nullable().optional(),
});
export type CreateMemberInput = z.infer<typeof CreateMemberSchema>;

export const MEMBER_CREATE_OUTCOMES = ['created', 'linked', 'restored'] as const;
export const MemberCreateOutcomeSchema = z.enum(MEMBER_CREATE_OUTCOMES);
export type MemberCreateOutcome = z.infer<typeof MemberCreateOutcomeSchema>;

export const CreateMemberResultSchema = z.object({
  member: TeamMemberRowSchema,
  outcome: MemberCreateOutcomeSchema,
  /** Only when `outcome === 'created'`; shown once, never stored in clear. */
  initialPassword: z.string().optional(),
});
export type CreateMemberResult = z.infer<typeof CreateMemberResultSchema>;

/**
 * `PATCH /company-members/:id`. Identity fields (names, phone) only apply
 * when the account belongs to a single company, otherwise 409.
 */
export const UpdateMemberSchema = z.object({
  role: MemberRoleSchema.optional(),
  status: MemberStatusSchema.optional(),
  acceptsAutoAssign: z.boolean().optional(),
  maxOpenConversations: z.number().int().min(1).nullable().optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phoneNumber: z.string().max(20).optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

/** `POST /company-members/:id/reset-password`. Shown once. */
export const ResetMemberPasswordResultSchema = z.object({
  password: z.string(),
});
export type ResetMemberPasswordResult = z.infer<
  typeof ResetMemberPasswordResultSchema
>;

/** `DELETE /company-members/:id`. */
export const RemoveMemberResultSchema = z.object({
  /** Open conversations sent back to the unassigned queue. */
  releasedConversations: z.number().int().min(0),
});
export type RemoveMemberResult = z.infer<typeof RemoveMemberResultSchema>;
