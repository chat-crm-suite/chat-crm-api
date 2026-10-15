// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { ExecutionContext } from '@nestjs/common';

import { PlatformGuard } from './platform.guard';
import type { PlatformService } from './platform.service';

describe('PlatformGuard', () => {
  const originalPassword = process.env.PLATFORM_CONSOLE_PASSWORD;
  const platform = { isUnlocked: jest.fn() };
  const guard = new PlatformGuard(platform as unknown as PlatformService);

  const context = (request: object, type = 'http') =>
    ({
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const request = (cookies: Record<string, string> | undefined, sub: string | null = 'admin-1') => ({
    user: sub ? { sub, memberships: [], ts: 1 } : undefined,
    cookies,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PLATFORM_CONSOLE_PASSWORD = 'console-secret';
  });

  afterAll(() => {
    if (originalPassword === undefined) delete process.env.PLATFORM_CONSOLE_PASSWORD;
    else process.env.PLATFORM_CONSOLE_PASSWORD = originalPassword;
  });

  it('lets an unlocked platform admin through, checking the token against the session user', async () => {
    platform.isUnlocked.mockResolvedValue(true);

    await expect(
      guard.canActivate(context(request({ platform_token: 'tok' }))),
    ).resolves.toBe(true);
    expect(platform.isUnlocked).toHaveBeenCalledWith('admin-1', 'tok');
  });

  it('answers 403 platform_locked when the token is missing, foreign or expired', async () => {
    platform.isUnlocked.mockResolvedValue(false);

    const attempts: (Record<string, string> | undefined)[] = [
      undefined,
      {},
      { platform_token: 'someone-elses' },
    ];
    for (const cookies of attempts) {
      await expect(guard.canActivate(context(request(cookies)))).rejects.toMatchObject({
        status: 403,
        response: { code: 'platform_locked' },
      });
    }
  });

  it('does not take the access token cookie for a platform token', async () => {
    platform.isUnlocked.mockResolvedValue(false);

    await expect(
      guard.canActivate(context(request({ access_token: 'session-jwt' }))),
    ).rejects.toMatchObject({ status: 403 });
    expect(platform.isUnlocked).toHaveBeenCalledWith('admin-1', undefined);
  });

  it.each([undefined, '', 'disabled'])(
    'answers 404 for every console route while the console is off (%p)',
    async (value) => {
      if (value === undefined) delete process.env.PLATFORM_CONSOLE_PASSWORD;
      else process.env.PLATFORM_CONSOLE_PASSWORD = value;
      platform.isUnlocked.mockResolvedValue(true);

      await expect(
        guard.canActivate(context(request({ platform_token: 'tok' }))),
      ).rejects.toMatchObject({ status: 404 });
      expect(platform.isUnlocked).not.toHaveBeenCalled();
    },
  );

  it('requires a session user', async () => {
    await expect(
      guard.canActivate(context(request({ platform_token: 'tok' }, null))),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('ignores non-http contexts (sockets)', async () => {
    await expect(guard.canActivate(context({}, 'ws'))).resolves.toBe(true);
  });
});
