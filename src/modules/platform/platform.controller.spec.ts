// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { IS_PUBLIC_KEY, IS_USER_SCOPED_KEY } from '../../auth/decorators/access.decorators';
import { PlatformCompaniesController } from './platform-companies.controller';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import type { PlatformService } from './platform.service';

describe('PlatformController', () => {
  const originalCookieSecure = process.env.COOKIE_SECURE;
  const platform = {
    status: jest.fn(),
    unlock: jest.fn(),
    lock: jest.fn(),
  };
  const controller = new PlatformController(platform as unknown as PlatformService);
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const res = { cookie, clearCookie } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COOKIE_SECURE;
  });

  afterAll(() => {
    if (originalCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalCookieSecure;
  });

  it('is user scoped: a session is enough, no x-company-id', () => {
    const reflector = new Reflector();

    expect(reflector.get<boolean>(IS_USER_SCOPED_KEY, PlatformController)).toBe(true);
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, PlatformController)).toBeUndefined();
  });

  it('reads the platform token from its own cookie for the status', async () => {
    platform.status.mockResolvedValue({ enabled: true, unlocked: true });

    await controller.status('admin-1', {
      cookies: { platform_token: 'tok', access_token: 'session' },
    } as unknown as Request);

    expect(platform.status).toHaveBeenCalledWith('admin-1', 'tok');
  });

  it('sets the 30 minute httpOnly strict cookie on unlock', async () => {
    const expiresAt = new Date('2026-10-14T12:30:00Z');
    platform.unlock.mockResolvedValue({ token: 'platform-jwt', expiresAt });

    const status = await controller.unlock('admin-1', { password: 'pw' }, res);

    expect(platform.unlock).toHaveBeenCalledWith('admin-1', 'pw');
    expect(cookie).toHaveBeenCalledWith('platform_token', 'platform-jwt', {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/',
      maxAge: 30 * 60 * 1000,
    });
    expect(status).toEqual({ enabled: true, unlocked: true, expiresAt });
  });

  it('marks the cookie Secure when COOKIE_SECURE=1', async () => {
    process.env.COOKIE_SECURE = '1';
    platform.unlock.mockResolvedValue({ token: 't', expiresAt: new Date() });

    await controller.unlock('admin-1', { password: 'pw' }, res);

    expect(cookie).toHaveBeenCalledWith(
      'platform_token',
      't',
      expect.objectContaining({ secure: true }),
    );
  });

  it('sets no cookie when the unlock is refused', async () => {
    platform.unlock.mockRejectedValue(new Error('403'));

    await expect(controller.unlock('admin-1', { password: 'bad' }, res)).rejects.toThrow();
    expect(cookie).not.toHaveBeenCalled();
  });

  it('clears the cookie with the same flags on lock', () => {
    const status = controller.lock('admin-1', res);

    expect(platform.lock).toHaveBeenCalledWith('admin-1');
    expect(clearCookie).toHaveBeenCalledWith(
      'platform_token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
    expect(status).toEqual({ enabled: true, unlocked: false });
  });
});

describe('PlatformCompaniesController', () => {
  it('sits behind PlatformGuard and is user scoped (independent from the tenant guard)', () => {
    const reflector = new Reflector();

    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformCompaniesController)).toContain(
      PlatformGuard,
    );
    expect(reflector.get<boolean>(IS_USER_SCOPED_KEY, PlatformCompaniesController)).toBe(true);
  });
});
