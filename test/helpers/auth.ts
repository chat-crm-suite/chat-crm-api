// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CacheModule } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';

import type { JwtPayload } from '@auth/auth.types';
import { getJwtSecret } from '@auth/jwt.config';
import type { MembershipClaim } from '@contracts';

/**
 * In-memory stand-in for the global cache `AppConfigsModule` registers (the
 * auth layer keeps its stale-session markers there). For fixtures that boot
 * `AuthModule` without the full app config.
 */
export const testCacheModule = () => CacheModule.register({ isGlobal: true });

/**
 * Signs an access token exactly like `AuthService.issueToken`, for tests that
 * need a session without going through `/auth/login` (or a hand-crafted one,
 * e.g. a token issued before the tenant claims existed).
 */
export function signTestToken(
  claims: { sub: string; memberships?: MembershipClaim[]; ts?: number } & Record<
    string,
    unknown
  >,
): string {
  const payload: Partial<JwtPayload> & Record<string, unknown> = {
    memberships: [],
    ts: Date.now(),
    ...claims,
  };

  return new JwtService({ secret: getJwtSecret() }).sign(payload, {
    expiresIn: '1h',
  });
}

/** `Cookie` header value carrying the session token. */
export const authCookie = (token: string) => `access_token=${token}`;

/** Reads the session token a response set through `Set-Cookie`. */
export function readAuthCookie(setCookie: string | string[] | undefined): string | null {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = /(?:^|;\s*)access_token=([^;]+)/.exec(header);
    if (match) return decodeURIComponent(match[1]);
  }

  return null;
}
