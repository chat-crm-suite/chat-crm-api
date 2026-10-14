// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

/** DI token of the shared Redis client (analytics cache, presence). */
export const APP_REDIS = 'APP_REDIS';

/**
 * The Redis commands the app relies on, so tests can provide an in-memory
 * stand-in without a server.
 */
export type AppRedis = Pick<
  Redis,
  'get' | 'mget' | 'set' | 'del' | 'incr' | 'pexpire'
>;

/**
 * Same connection policy as the IA client: `lazyConnect` so importing the
 * module opens nothing, and one retry per command so an outage surfaces fast
 * (callers fail open: Redis only ever speeds things up).
 */
export function createAppRedis(logger: PinoLogger): Redis {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  redis.on('error', (err: Error) => logger.warn({ err }, 'App Redis error'));

  return redis;
}

@Injectable()
class AppRedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(APP_REDIS) private readonly redis: AppRedis) {}

  onModuleDestroy(): void {
    (this.redis as Partial<Redis>).disconnect?.();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_REDIS,
      useFactory: (logger: PinoLogger) => createAppRedis(logger),
      inject: [PinoLogger],
    },
    AppRedisLifecycle,
  ],
  exports: [APP_REDIS],
})
export class AppRedisModule {}
