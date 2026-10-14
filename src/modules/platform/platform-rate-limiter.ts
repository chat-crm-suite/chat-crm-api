// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { APP_REDIS, type AppRedis } from '../../common/redis/app-redis.module';
import {
  PLATFORM_ATTEMPT_WINDOW_MS,
  PLATFORM_MAX_FAILED_ATTEMPTS,
} from './platform.config';

type Attempts = { count: number; resetAt: number };

const failsKey = (userId: string) => `platform:unlock:fails:${userId}`;
const sinceKey = (userId: string) => `platform:unlock:since:${userId}`;

/**
 * Failed-unlock counter per user: `PLATFORM_MAX_FAILED_ATTEMPTS` inside
 * `PLATFORM_ATTEMPT_WINDOW_MS`. Lives in Redis (shared by every API process)
 * and falls back to this process memory when Redis is absent or erroring, so
 * the limit never disappears.
 */
@Injectable()
export class PlatformRateLimiter {
  private readonly local = new Map<string, Attempts>();

  constructor(
    private readonly logger: PinoLogger,
    @Optional() @Inject(APP_REDIS) private readonly redis?: AppRedis,
  ) {
    this.logger.setContext(PlatformRateLimiter.name);
  }

  /** Seconds the user must wait before trying again; 0 when allowed. */
  async retryAfterSec(userId: string, now = Date.now()): Promise<number> {
    const attempts = await this.read(userId);
    if (!attempts || attempts.count < PLATFORM_MAX_FAILED_ATTEMPTS) return 0;

    return Math.max(1, Math.ceil((attempts.resetAt - now) / 1000));
  }

  /** Records a failed attempt; returns the attempts used so far in the window. */
  async registerFailure(userId: string, now = Date.now()): Promise<number> {
    if (this.redis) {
      try {
        const count = await this.redis.incr(failsKey(userId));
        if (count === 1) {
          await this.redis.pexpire(failsKey(userId), PLATFORM_ATTEMPT_WINDOW_MS);
          await this.redis.set(
            sinceKey(userId),
            String(now),
            'PX',
            PLATFORM_ATTEMPT_WINDOW_MS,
          );
        }
        return count;
      } catch (error) {
        this.logger.warn({ error: String(error) }, 'Redis unavailable, using local attempt counter');
      }
    }

    const current = this.local.get(userId);
    const active = current && current.resetAt > now ? current : null;
    const next = {
      count: (active?.count ?? 0) + 1,
      resetAt: active?.resetAt ?? now + PLATFORM_ATTEMPT_WINDOW_MS,
    };
    this.local.set(userId, next);

    return next.count;
  }

  async clear(userId: string): Promise<void> {
    this.local.delete(userId);
    if (!this.redis) return;

    try {
      await this.redis.del(failsKey(userId), sinceKey(userId));
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Could not clear the Redis attempt counter');
    }
  }

  private async read(userId: string): Promise<Attempts | null> {
    const local = this.local.get(userId);
    const now = Date.now();
    const localAttempts = local && local.resetAt > now ? local : null;

    if (!this.redis) return localAttempts;

    try {
      const [count, since] = await this.redis.mget(failsKey(userId), sinceKey(userId));
      if (count === null) return localAttempts;

      const start = since === null ? now : Number(since);
      const shared = {
        count: Number(count),
        resetAt: start + PLATFORM_ATTEMPT_WINDOW_MS,
      };

      return localAttempts && localAttempts.count > shared.count ? localAttempts : shared;
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'Redis unavailable, using local attempt counter');
      return localAttempts;
    }
  }
}
