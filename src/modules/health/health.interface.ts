// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

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
