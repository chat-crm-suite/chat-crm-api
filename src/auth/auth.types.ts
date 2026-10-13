// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type {
  AuthUser as AuthUserContract,
  MemberRole,
  MembershipClaim,
} from '../contracts/index';

/** `GET /auth/me` / `GET /users/me` shape (identity + memberships). */
export type AuthUser = AuthUserContract;

/**
 * Access token claims: identity plus the user's active memberships, so the
 * tenant guard validates `x-company-id` without touching the DB or Redis.
 * `ts` is the issue time in milliseconds (JWT `iat` is only seconds), compared
 * against the per-user stale marker written on revocation.
 */
export type JwtPayload = {
  sub: string;
  memberships: MembershipClaim[];
  ts: number;
  iat?: number;
  exp?: number;
};

/** Verified tenant scope of a request, set by `TenantGuard`. */
export type TenantContext = {
  companyId: string;
  memberId: string;
  role: MemberRole;
};
