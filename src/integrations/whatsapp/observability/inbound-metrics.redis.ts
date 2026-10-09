// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

/** DI token of the Redis connection backing the inbound operational counters. */
export const INBOUND_METRICS_REDIS = 'INBOUND_METRICS_REDIS';

/**
 * Ticket #24: dedicated ioredis connection for the inbound counters, shared
 * by the metrics subscriber. `lazyConnect` keeps importing the module from
 * opening a socket; a single retry per command makes a Redis outage surface
 * quickly instead of piling up queued commands. Separated from the IA Redis so
 * a metrics burst can never delay the analysis hot path.
 */
export function createInboundMetricsRedis(logger: PinoLogger): Redis {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  redis.on('error', (err: Error) =>
    logger.warn({ err }, 'Inbound metrics Redis error'),
  );

  return redis;
}
