import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { HealthCheck, HealthStatus } from '../health.enum';
import { HealthCheckResult } from '../health.interface';
import { HealthProbe } from '../health.probe';

@Injectable()
export class DatabaseProbe implements HealthProbe {
  readonly name = HealthCheck.Database;
  readonly critical = true;

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<HealthCheckResult> {
    try {
      await this.dataSource.query('SELECT 1');
      return { name: this.name, status: HealthStatus.Ok };
    } catch (err) {
      return {
        name: this.name,
        status: HealthStatus.Fail,
        detail: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
