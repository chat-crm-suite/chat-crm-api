import { HealthStatus } from './health.enum';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  detail?: string;
}

export interface HealthReport {
  status: 'ready' | 'not-ready';
  checks: Record<string, string>;
  uptime: number;
  timestamp: string;
}
