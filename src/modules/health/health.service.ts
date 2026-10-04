import { Inject, Injectable } from '@nestjs/common';

import { HealthStatus } from './health.enum';
import { HealthReport } from './health.interface';
import { HEALTH_PROBES, HealthProbe } from './health.probe';

@Injectable()
export class HealthService {
  constructor(
    @Inject(HEALTH_PROBES) private readonly probes: HealthProbe[],
  ) {}

  async check(): Promise<HealthReport> {
    const results = await Promise.all(
      this.probes.map(async (probe) => ({ probe, result: await probe.check() })),
    );

    const checks: Record<string, string> = {};
    for (const { probe, result } of results) {
      checks[probe.name] = result.status;
    }

    const failed = results.some(
      ({ probe, result }) =>
        probe.critical && result.status !== HealthStatus.Ok,
    );

    return {
      status: failed ? 'not-ready' : 'ready',
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
