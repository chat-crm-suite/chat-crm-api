// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { COMPANY_HEADER } from '../../contracts/index';
import type { JwtPayload, TenantContext } from '../auth.types';
import { IS_PUBLIC_KEY, IS_USER_SCOPED_KEY } from '../decorators/access.decorators';
import { findMembership, toTenantContext } from '../membership';

export type TenantRequest = Request & {
  user?: JwtPayload;
  tenant?: TenantContext;
};

/**
 * Global tenant guard (`APP_GUARD`, runs after `JwtAuthGuard`). The client
 * picks the active company per request with `x-company-id`; it is honored
 * only when it is one of the verified token's memberships, checked in memory.
 * The resulting `req.tenant` is the only source the CLS trusts.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(IS_USER_SCOPED_KEY, targets)
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest<TenantRequest>();
    const header = req.headers[COMPANY_HEADER];
    const companyId = Array.isArray(header) ? header[0] : header;
    if (!companyId) {
      throw new BadRequestException('Company context required');
    }

    const membership = findMembership(req.user, companyId);
    if (!membership) {
      throw new ForbiddenException('Not a member of this company');
    }

    req.tenant = toTenantContext(membership);
    return true;
  }
}
