// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const IS_USER_SCOPED_KEY = 'auth:isUserScoped';

/**
 * No session required (health, setup, webhooks, login). Skips both the
 * global JWT guard and the tenant guard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Session required but no company context: the route works across the user's
 * companies (profile, session refresh) or derives the company from the
 * resource itself (attachments). Skips only the tenant guard.
 */
export const UserScoped = () => SetMetadata(IS_USER_SCOPED_KEY, true);
