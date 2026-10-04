import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import healthConfig from '../../../config/health.config';
import { HealthCheck, HealthStatus } from '../health.enum';
import { HealthCheckResult } from '../health.interface';
import { HealthProbe } from '../health.probe';

/**
 * IA opcional: nunca es crítica. Si no está levantada se reporta
 * 'unreachable' y la readiness sigue 'ready'.
 */
@Injectable()
export class IaProbe implements HealthProbe {
  readonly name = HealthCheck.Ia;
  readonly critical = false;

  constructor(
    @Inject(healthConfig.KEY)
    private readonly config: ConfigType<typeof healthConfig>,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const { iaUrl, iaTimeoutMs } = this.config;
    if (!iaUrl) {
      return { name: this.name, status: HealthStatus.Skipped };
    }

    try {
      const res = await fetch(`${iaUrl}/health`, {
        signal: AbortSignal.timeout(iaTimeoutMs),
      });
      return {
        name: this.name,
        status: res.ok ? HealthStatus.Ok : HealthStatus.Unreachable,
      };
    } catch {
      return { name: this.name, status: HealthStatus.Unreachable };
    }
  }
}
