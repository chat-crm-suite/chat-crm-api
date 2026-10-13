// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Single source for CLS (continuation-local storage) key names, so variants
 * like 'user-id' vs 'user.id' cannot drift apart and break tenant isolation.
 *
 * Every value is set from verified data only: the user from the JWT and the
 * company/member/role from the tenant guard (never from a raw header).
 */
export const CLS_USER_ID = 'user.id' as const;
export const CLS_COMPANY_ID = 'company.id' as const;
export const CLS_MEMBER_ID = 'member.id' as const;
export const CLS_MEMBER_ROLE = 'member.role' as const;
