// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import { getJwtSecret } from '../../auth/jwt.config';

/** httpOnly cookie that proves the console was unlocked (separate from `access_token`). */
export const PLATFORM_COOKIE = 'platform_token';

/** Audience of the platform token; the access token has none. */
export const PLATFORM_AUDIENCE = 'platform';

/** How long an unlock lasts before the console locks itself again. */
export const PLATFORM_TOKEN_TTL_SECONDS = 30 * 60;

/** Failed unlock attempts allowed per user inside the window below. */
export const PLATFORM_MAX_FAILED_ATTEMPTS = 5;
export const PLATFORM_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Console password from the environment, or `null` when the console is off:
 * unset, empty or the explicit value `disabled`. Read on every call so a
 * restart is the only thing needed to change it.
 */
export function getPlatformPassword(): string | null {
  const value = process.env.PLATFORM_CONSOLE_PASSWORD?.trim();
  if (!value || value.toLowerCase() === 'disabled') return null;

  return value;
}

export function isPlatformConsoleEnabled(): boolean {
  return getPlatformPassword() !== null;
}

/**
 * Signing key of the platform token, derived from `JWT_SECRET` so an access
 * token (signed with the secret itself) can never be replayed as a platform
 * token, nor the other way around.
 */
export function getPlatformSigningKey(): string {
  return createHmac('sha256', getJwtSecret())
    .update('platform-console')
    .digest('hex');
}

/** Constant-time password check over fixed-length digests. */
export function passwordMatches(candidate: string, expected: string): boolean {
  const digest = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest();

  return timingSafeEqual(digest(candidate), digest(expected));
}
