// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { APP_REDIS, type AppRedis } from '../../common/redis/app-redis.module';

/** Counts are short-lived: time alone moves conversations into a signal. */
export const WORK_QUEUE_COUNTS_TTL_MS = 15_000;

export const workQueueVersionKey = (companyId: string) => `wq:v:${companyId}`;

/**
 * Cache-aside for the work-queue counts (sidebar badge), per company and
 * scope. A task or conversation change only `INCR`s the company version, so
 * stale counts are never read again and expire on their own. Fail-open: any
 * Redis error computes directly.
 */
@Injectable()
export class WorkQueueCache {
  constructor(
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkQueueCache.name);
  }

  async wrap<T>(companyId: string, scopeKey: string, compute: () => Promise<T>): Promise<T> {
    let dataKey: string;
    try {
      const version = (await this.redis.get(workQueueVersionKey(companyId))) ?? '0';
      dataKey = `wq:d:${companyId}:${version}:${scopeKey}`;
      const hit = await this.redis.get(dataKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.warn(error);
      return compute();
    }

    const value = await compute();
    await this.redis
      .set(dataKey, JSON.stringify(value), 'PX', WORK_QUEUE_COUNTS_TTL_MS)
      .catch((error: unknown) => this.warn(error));

    return value;
  }

  async invalidate(companyId: string | null | undefined): Promise<void> {
    if (!companyId) return;
    try {
      await this.redis.incr(workQueueVersionKey(companyId));
    } catch (error) {
      this.warn(error);
    }
  }

  private warn(error: unknown): void {
    this.logger.warn({ error: String(error) }, 'Work queue cache unavailable');
  }
}
