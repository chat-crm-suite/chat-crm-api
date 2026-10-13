// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import { MemberRoleSchema } from './member.contract';
import { AuthUserSchema } from './user.contract';

/**
 * Auth contracts (login, session, tenant context).
 *
 * NOTE: these schemas are the single source of truth for both sides:
 * - API: consumed through `createZodDto` (validation + Swagger schema).
 * - Frontend: consumed through the `@chat-crm/contracts` alias.
 * Keep them as portable TypeScript (only `zod` imports allowed).
 */
export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  message: z.string(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * Header the client uses to pick the active company on every request. The
 * server only honors it when the company is one of the token's memberships.
 */
export const COMPANY_HEADER = 'x-company-id' as const;

/**
 * Machine-readable auth error codes (`{ code }` in the error body).
 * `token_stale`: the session's memberships changed (or the token predates the
 * tenant claims); the client calls `POST /auth/refresh-memberships` and
 * retries the request.
 */
export const AUTH_ERROR_CODES = {
  tokenStale: 'token_stale',
} as const;

/**
 * One active membership embedded in the access token, so the tenant guard can
 * validate `x-company-id` in memory: `cid` company id, `mid` member id.
 */
export const MembershipClaimSchema = z.object({
  cid: z.string(),
  mid: z.string(),
  role: MemberRoleSchema,
});

export type MembershipClaim = z.infer<typeof MembershipClaimSchema>;

/**
 * `GET /auth/me` and `POST /auth/refresh-memberships` response. The client
 * keeps `user.memberships` as its company list and picks the active company
 * locally (switching companies costs no request).
 */
export const AuthSessionResponseSchema = z.object({
  user: AuthUserSchema,
});

export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
