// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { StagedUploadStore } from './staged-upload.store';

export const STAGED_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes abandoned uploads every hour. Deleting an expired file is
 * idempotent, so several API instances sweeping at once is harmless and no
 * scheduler dependency is needed.
 */
@Injectable()
export class StagedUploadSweeper
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: StagedUploadStore,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StagedUploadSweeper.name);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), STAGED_SWEEP_INTERVAL_MS);
    // Never keeps the process alive on shutdown.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const removed = await this.store.sweep();
      if (removed) this.logger.info({ removed }, 'Swept abandoned uploads');
    } catch (error: unknown) {
      this.logger.warn({ error: String(error) }, 'Upload sweep failed');
    }
  }
}
