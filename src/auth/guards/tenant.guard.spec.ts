// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload } from '../auth.types';
import { IS_PUBLIC_KEY, IS_USER_SCOPED_KEY } from '../decorators/access.decorators';
import { TenantGuard, type TenantRequest } from './tenant.guard';

const user: JwtPayload = {
  sub: 'user-1',
  memberships: [
    { cid: 'company-x', mid: 'member-1', role: 'admin' },
    { cid: 'company-y', mid: 'member-7', role: 'agent' },
  ],
  ts: 1,
};

function httpContext(
  req: Partial<TenantRequest>,
  metadata: Record<string, boolean> = {},
): { context: ExecutionContext; reflector: Reflector } {
  const handler = () => undefined;
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => metadata[key as string]);

  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe('TenantGuard', () => {
  it('scopes the request to a company from the token memberships', () => {
    const req: Partial<TenantRequest> = {
      user,
      headers: { 'x-company-id': 'company-y' },
    };
    const { context, reflector } = httpContext(req);

    expect(new TenantGuard(reflector).canActivate(context)).toBe(true);
    expect(req.tenant).toEqual({
      companyId: 'company-y',
      memberId: 'member-7',
      role: 'agent',
    });
  });

  it('answers 400 without a company header', () => {
    const { context, reflector } = httpContext({ user, headers: {} });

    expect(() => new TenantGuard(reflector).canActivate(context)).toThrow(
      BadRequestException,
    );
  });

  it('answers 403 for a company outside the token memberships', () => {
    const req: Partial<TenantRequest> = {
      user,
      headers: { 'x-company-id': 'company-z' },
    };
    const { context, reflector } = httpContext(req);

    expect(() => new TenantGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );
    expect(req.tenant).toBeUndefined();
  });

  it('answers 403 for a token without tenant claims', () => {
    const req: Partial<TenantRequest> = {
      user: { sub: 'user-1' } as JwtPayload,
      headers: { 'x-company-id': 'company-x' },
    };
    const { context, reflector } = httpContext(req);

    expect(() => new TenantGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it.each([IS_PUBLIC_KEY, IS_USER_SCOPED_KEY])(
    'skips routes marked %s',
    (key) => {
      const req: Partial<TenantRequest> = { headers: {} };
      const { context, reflector } = httpContext(req, { [key]: true });

      expect(new TenantGuard(reflector).canActivate(context)).toBe(true);
      expect(req.tenant).toBeUndefined();
    },
  );

  it('lets socket contexts through (the gateway authorizes per event)', () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;

    expect(new TenantGuard(new Reflector()).canActivate(context)).toBe(true);
  });
});
