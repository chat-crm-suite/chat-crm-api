// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';

import { HealthService } from './health.service';

/**
 * Públicos (sin guardas): los consume el HEALTHCHECK de Docker y el smoke test.
 * `/health` es liveness (proceso vivo) y `/health/ready` readiness (503 si
 * falla una dependencia crítica).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get()
  live() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    const report = await this.service.check();
    if (report.status === 'not-ready') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return report;
  }
}
