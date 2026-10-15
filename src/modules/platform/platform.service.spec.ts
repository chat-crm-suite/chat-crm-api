// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { JwtService } from '@nestjs/jwt';
import type { PinoLogger } from 'nestjs-pino';
import type { Repository } from 'typeorm';

import { getJwtSecret } from '../../auth/jwt.config';
import { MemoryRedis } from '@helpers/memory-redis';
import type { AppRedis } from '../../common/redis/app-redis.module';
import type { User } from '../users/entities/user.entity';
import { PlatformRateLimiter } from './platform-rate-limiter';
import { PlatformTokenService } from './platform-token.service';
import { getPlatformSigningKey, PLATFORM_ATTEMPT_WINDOW_MS } from './platform.config';
import { PlatformService } from './platform.service';

const PASSWORD = 'console-secret-0123456789abcdef';

describe('PlatformService', () => {
  const originalPassword = process.env.PLATFORM_CONSOLE_PASSWORD;
  let admins: Map<string, boolean>;
  let redis: MemoryRedis | undefined;
  let logger: { setContext: jest.Mock; info: jest.Mock; warn: jest.Mock };

  const build = () => {
    const users = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          admins.has(where.id)
            ? { id: where.id, isPlatformAdmin: admins.get(where.id) }
            : null,
        ),
      ),
    };
    const limiter = new PlatformRateLimiter(
      logger as unknown as PinoLogger,
      redis as unknown as AppRedis | undefined,
    );
    const tokens = new PlatformTokenService(new JwtService());
    const service = new PlatformService(
      users as unknown as Repository<User>,
      tokens,
      limiter,
      logger as unknown as PinoLogger,
    );

    return { service, tokens, limiter };
  };

  /** Audit entries as logged, to prove no password ever reaches the log. */
  const audited = () =>
    logger.info.mock.calls.map(([meta]) => meta as Record<string, unknown>);

  beforeEach(() => {
    process.env.PLATFORM_CONSOLE_PASSWORD = PASSWORD;
    admins = new Map([
      ['admin-1', true],
      ['admin-2', true],
      ['plain-user', false],
    ]);
    redis = new MemoryRedis();
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  });

  afterAll(() => {
    if (originalPassword === undefined) delete process.env.PLATFORM_CONSOLE_PASSWORD;
    else process.env.PLATFORM_CONSOLE_PASSWORD = originalPassword;
  });

  describe('console switched off', () => {
    it.each([undefined, '', '   ', 'disabled', 'DISABLED'])(
      'answers 404 to unlock and lock when the password is %p',
      async (value) => {
        if (value === undefined) delete process.env.PLATFORM_CONSOLE_PASSWORD;
        else process.env.PLATFORM_CONSOLE_PASSWORD = value;
        const { service } = build();

        await expect(service.unlock('admin-1', PASSWORD)).rejects.toMatchObject({ status: 404 });
        expect(() => service.lock('admin-1')).toThrow(/Not Found/);
      },
    );

    it('still answers status, with enabled:false, so the app can hide the entry', async () => {
      process.env.PLATFORM_CONSOLE_PASSWORD = 'disabled';
      const { service } = build();

      await expect(service.status('admin-1', undefined)).resolves.toEqual({
        enabled: false,
        unlocked: false,
      });
    });
  });

  describe('unlock()', () => {
    it('hands a token to a platform admin who knows the password', async () => {
      const { service, tokens } = build();

      const { token, expiresAt } = await service.unlock('admin-1', PASSWORD);

      expect(await tokens.verify(token)).toMatchObject({ sub: 'admin-1' });
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
      await expect(service.status('admin-1', token)).resolves.toMatchObject({
        enabled: true,
        unlocked: true,
      });
    });

    it('rejects a wrong password with 403, whatever its length', async () => {
      const { service } = build();

      for (const wrong of ['nope', PASSWORD + 'x', PASSWORD.slice(0, -1), 'a'.repeat(256)]) {
        await expect(service.unlock('admin-1', wrong)).rejects.toMatchObject({
          status: 403,
          response: { code: 'platform_invalid_password' },
        });
      }
    });

    it('rejects a user who is not a platform admin even with the right password', async () => {
      const { service } = build();

      await expect(service.unlock('plain-user', PASSWORD)).rejects.toMatchObject({
        status: 403,
        response: { code: 'platform_forbidden' },
      });
      await expect(service.unlock('ghost', PASSWORD)).rejects.toMatchObject({ status: 403 });
    });

    it('answers 429 with retryAfterSec after 5 failed attempts, even for the right password', async () => {
      const { service } = build();

      for (let attempt = 1; attempt <= 5; attempt++) {
        await expect(service.unlock('admin-1', 'wrong')).rejects.toMatchObject({ status: 403 });
      }

      const blocked = await service.unlock('admin-1', PASSWORD).catch((e: unknown) => e);
      expect(blocked).toMatchObject({ status: 429 });
      const body = (blocked as { response: Record<string, unknown> }).response;
      expect(body).toMatchObject({ enabled: true, unlocked: false });
      expect(body.retryAfterSec).toBeGreaterThan(0);
      expect(body.retryAfterSec).toBeLessThanOrEqual(PLATFORM_ATTEMPT_WINDOW_MS / 1000);
    });

    it('limits per user: another admin is not locked out', async () => {
      const { service } = build();
      for (let attempt = 0; attempt < 5; attempt++) {
        await service.unlock('admin-1', 'wrong').catch(() => undefined);
      }

      await expect(service.unlock('admin-2', PASSWORD)).resolves.toMatchObject({
        token: expect.any(String) as string,
      });
    });

    it('forgets earlier failures after a successful unlock', async () => {
      const { service } = build();
      for (let attempt = 0; attempt < 4; attempt++) {
        await service.unlock('admin-1', 'wrong').catch(() => undefined);
      }
      await service.unlock('admin-1', PASSWORD);

      for (let attempt = 0; attempt < 4; attempt++) {
        await expect(service.unlock('admin-1', 'wrong')).rejects.toMatchObject({ status: 403 });
      }
    });

    it('keeps limiting in memory when Redis is absent or down', async () => {
      for (const failing of [undefined, 'down'] as const) {
        redis = failing ? new MemoryRedis() : undefined;
        if (redis) redis.failing = true;
        const { service } = build();

        for (let attempt = 0; attempt < 5; attempt++) {
          await service.unlock('admin-1', 'wrong').catch(() => undefined);
        }
        await expect(service.unlock('admin-1', PASSWORD)).rejects.toMatchObject({
          status: 429,
        });
      }
    });

    it('shares the counter between processes through Redis', async () => {
      const first = build();
      for (let attempt = 0; attempt < 5; attempt++) {
        await first.service.unlock('admin-1', 'wrong').catch(() => undefined);
      }

      const otherProcess = build();

      await expect(otherProcess.service.unlock('admin-1', PASSWORD)).rejects.toMatchObject({
        status: 429,
      });
    });

    it('audit-logs every attempt with the user id and never the password', async () => {
      const { service } = build();

      await service.unlock('admin-1', 'wrong-guess').catch(() => undefined);
      await service.unlock('plain-user', PASSWORD).catch(() => undefined);
      await service.unlock('admin-1', PASSWORD);

      expect(audited().map((entry) => [entry.event, entry.userId])).toEqual([
        ['unlock_failed', 'admin-1'],
        ['unlock_denied', 'plain-user'],
        ['unlock_succeeded', 'admin-1'],
      ]);
      const serialized = JSON.stringify(logger.info.mock.calls);
      expect(serialized).not.toContain('wrong-guess');
      expect(serialized).not.toContain(PASSWORD);
    });
  });

  describe('isUnlocked()', () => {
    it('is false without a token or with garbage', async () => {
      const { service } = build();

      for (const token of [undefined, '', 'garbage', 42, {}]) {
        await expect(service.isUnlocked('admin-1', token)).resolves.toBe(false);
      }
    });

    it('rejects the token of another user', async () => {
      const { service } = build();
      const { token } = await service.unlock('admin-2', PASSWORD);

      await expect(service.isUnlocked('admin-1', token)).resolves.toBe(false);
      await expect(service.isUnlocked('admin-2', token)).resolves.toBe(true);
    });

    it('rejects a regular access token, which is signed with JWT_SECRET itself', async () => {
      const { service } = build();
      const accessToken = new JwtService({ secret: getJwtSecret() }).sign(
        { sub: 'admin-1', memberships: [], ts: Date.now() },
        { expiresIn: '1h' },
      );

      await expect(service.isUnlocked('admin-1', accessToken)).resolves.toBe(false);
    });

    it('rejects a platform-signed token without the platform audience', async () => {
      const { service, tokens } = build();
      const { token } = await tokens.sign('admin-1');
      const [, payload] = token.split('.');
      const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;

      await expect(service.isUnlocked('admin-1', forged)).resolves.toBe(false);
    });

    it('locks again as soon as the user stops being a platform admin', async () => {
      const { service } = build();
      const { token } = await service.unlock('admin-1', PASSWORD);

      admins.set('admin-1', false);

      await expect(service.isUnlocked('admin-1', token)).resolves.toBe(false);
      await expect(service.status('admin-1', token)).resolves.toMatchObject({
        enabled: true,
        unlocked: false,
      });
    });

    it('rejects an expired token', async () => {
      const { service } = build();
      const jwt = new JwtService();
      const expired = jwt.sign(
        { sub: 'admin-1' },
        { secret: getPlatformSigningKey(), audience: 'platform', expiresIn: -10 },
      );

      await expect(service.isUnlocked('admin-1', expired)).resolves.toBe(false);
    });
  });
});
