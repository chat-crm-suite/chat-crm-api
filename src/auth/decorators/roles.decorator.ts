// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { SetMetadata } from '@nestjs/common';

import type { MemberRole } from '../../contracts/index';

export const ROLES_KEY = 'auth:roles';

/**
 * Restricts a route to members whose role in the active company (verified by
 * `TenantGuard`) is one of `roles`. Without it, any member may call the route.
 */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
