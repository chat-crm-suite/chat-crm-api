// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import type { ConfigType } from '@nestjs/config';

import healthConfig from '../../../config/health.config';
import { HealthCheck, HealthStatus } from '../health.enum';
import { HealthCheckResult } from '../health.interface';
import { HealthProbe } from '../health.probe';

/**
 * Sonda contra el CacheModule real (cache.config.ts: memoria + Redis).
 * Un `set/get/del` confirma que ambas capas responden sin duplicar la
 * construcción de la URL de Redis.
 */
@Injectable()
export class CacheProbe implements HealthProbe {
  readonly name = HealthCheck.Cache;
  readonly critical = true;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(healthConfig.KEY)
    private readonly config: ConfigType<typeof healthConfig>,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const key = `health:ready:${Date.now()}`;
    try {
      await this.cache.set(key, 'ok', this.config.probeTtlMs);
      const value = await this.cache.get(key);
      await this.cache.del(key);

      return value === 'ok'
        ? { name: this.name, status: HealthStatus.Ok }
        : { name: this.name, status: HealthStatus.Fail, detail: 'cache read mismatch' };
    } catch (err) {
      return {
        name: this.name,
        status: HealthStatus.Fail,
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
