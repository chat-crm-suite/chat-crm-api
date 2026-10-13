// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { MembershipClaim } from '../contracts/index';
import type { JwtPayload, TenantContext } from './auth.types';

/**
 * Single in-memory membership check shared by the HTTP tenant guard, the
 * socket gateway and the attachments endpoint: the company must be one of the
 * verified token's memberships.
 */
export function findMembership(
  user: Pick<JwtPayload, 'memberships'> | null | undefined,
  companyId: string | null | undefined,
): MembershipClaim | null {
  if (!companyId || !Array.isArray(user?.memberships)) return null;

  return user.memberships.find((membership) => membership.cid === companyId) ?? null;
}

/** Maps a token membership to the request tenant scope. */
export function toTenantContext(membership: MembershipClaim): TenantContext {
  return {
    companyId: membership.cid,
    memberId: membership.mid,
    role: membership.role,
  };
}

/** True when the payload carries the tenant claims (tokens issued before them do not). */
export function hasTenantClaims(payload: Partial<JwtPayload> | null | undefined): boolean {
  return Array.isArray(payload?.memberships) && typeof payload?.ts === 'number';
}
