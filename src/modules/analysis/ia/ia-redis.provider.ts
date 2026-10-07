// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

/** DI token of the Redis client shared by the IA availability mechanisms. */
export const IA_REDIS = 'IA_REDIS';

/**
 * Dedicated ioredis connection for the kill switch and the circuit breaker.
 * `lazyConnect` keeps importing the module from opening a socket, and a single
 * retry per request makes a Redis outage surface quickly instead of piling up
 * queued commands on the analysis hot path.
 */
export function createIaRedis(logger: PinoLogger): Redis {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  redis.on('error', (err: Error) => logger.warn({ err }, 'IA Redis error'));

  return redis;
}
