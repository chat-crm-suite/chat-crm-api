// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { TenantContext } from '../auth.types';
import type { TenantRequest } from '../guards/tenant.guard';

/** Verified tenant scope set by `TenantGuard` (or one of its fields). */
export const tenantFactory = (
  data: keyof TenantContext | undefined,
  ctx: ExecutionContext,
): TenantContext | TenantContext[keyof TenantContext] | undefined => {
  const tenant = ctx.switchToHttp().getRequest<TenantRequest>().tenant;

  return data ? tenant?.[data] : tenant;
};

export const CurrentTenant = createParamDecorator(tenantFactory);
