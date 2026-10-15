// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';

const httpContext = () =>
  ({
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const passportCanActivate = jest
    .spyOn(AuthGuard('jwt').prototype, 'canActivate')
    .mockReturnValue(true);

  afterEach(() => passportCanActivate.mockClear());

  it('skips verification on @Public() routes', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    expect(new JwtAuthGuard(reflector).canActivate(httpContext())).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('verifies the session cookie on every other HTTP route', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    new JwtAuthGuard(reflector).canActivate(httpContext());

    expect(passportCanActivate).toHaveBeenCalled();
  });

  it('lets socket contexts through (the gateway verifies the handshake)', () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;

    expect(new JwtAuthGuard(new Reflector()).canActivate(context)).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });
});
