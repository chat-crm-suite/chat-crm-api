// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { bullmqConfig } from '../../../config/bullmq.config';
import { HealthCheck, HealthStatus } from '../health.enum';
import { HealthCheckResult } from '../health.interface';
import { HealthProbe } from '../health.probe';

/**
 * BullMQ comparte el Redis de bullmq.config.ts. Se abre una cola efímera
 * solo para el chequeo: las colas de los módulos hijos no son inyectables aquí.
 */
@Injectable()
export class BullMqProbe implements HealthProbe {
  readonly name = HealthCheck.BullMq;
  readonly critical = true;

  async check(): Promise<HealthCheckResult> {
    const queue = new Queue('health-probe', { connection: bullmqConfig.connection });
    try {
      await queue.getJobCounts();
      return { name: this.name, status: HealthStatus.Ok };
    } catch (err) {
      return {
        name: this.name,
        status: HealthStatus.Fail,
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    } finally {
      await queue.close();
    }
  }
}
