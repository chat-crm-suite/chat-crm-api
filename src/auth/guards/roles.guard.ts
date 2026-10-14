// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { MemberRole } from '../../contracts/index';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { TenantRequest } from './tenant.guard';

/**
 * Global role gate (`APP_GUARD`, runs after `TenantGuard`): a route tagged
 * with `@Roles(...)` needs the active membership's role to be one of them.
 * Untagged routes pass, so the guard is opt-in per route or controller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const role = context.switchToHttp().getRequest<TenantRequest>().tenant?.role;
    if (!role || !roles.includes(role)) {
      throw new ForbiddenException('Your role cannot access this resource');
    }

    return true;
  }
}
