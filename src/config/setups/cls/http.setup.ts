// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ClsService } from 'nestjs-cls';
import { ExecutionContext } from '@nestjs/common';

import type { TenantRequest } from '@auth/guards/tenant.guard';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_MEMBER_ROLE,
  CLS_USER_ID,
} from '../../cls.keys';

/**
 * Runs after the guards: the user comes from the verified JWT and the tenant
 * scope from `TenantGuard`. The raw `x-company-id` header is never read here,
 * so services can trust `company.id`.
 */
export function setupHttpContext(cls: ClsService, context: ExecutionContext) {
  const req = context.switchToHttp().getRequest<TenantRequest>();

  cls.set(CLS_USER_ID, req.user?.sub);
  cls.set(CLS_COMPANY_ID, req.tenant?.companyId);
  cls.set(CLS_MEMBER_ID, req.tenant?.memberId);
  cls.set(CLS_MEMBER_ROLE, req.tenant?.role);
}
