// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { IA_REDIS } from './ia-redis.provider';

/** Redis key of the manual kill switch; absent means the IA is enabled. */
export const KILL_SWITCH_KEY = 'ia:enabled';

/**
 * T2: operator-controlled kill switch for the IA. The flag lives in Redis and
 * is read hot on every analysis decision, so flipping it takes effect without
 * a redeploy. An absent key means enabled (fail-open to the feature) and a
 * Redis failure also fails open, with a warning — never an error.
 */
@Injectable()
export class KillSwitchService implements OnModuleDestroy {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(IA_REDIS) private readonly redis: Redis,
  ) {
    this.logger.setContext(KillSwitchService.name);
  }

  /** Hot read: only an explicit `false` disables the IA. */
  async isEnabled(): Promise<boolean> {
    try {
      return (await this.redis.get(KILL_SWITCH_KEY)) !== 'false';
    } catch (err: unknown) {
      this.logger.warn(
        { err },
        'Kill switch read failed; IA treated as enabled',
      );
      return true;
    }
  }

  /** Persists the flag and returns the resulting state. */
  async setEnabled(enabled: boolean): Promise<boolean> {
    await this.redis.set(KILL_SWITCH_KEY, String(enabled));

    return enabled;
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
