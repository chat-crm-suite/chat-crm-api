// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

export enum HealthCheck {
  Database = 'database',
  Cache = 'cache',
  BullMq = 'bullmq',
  Ia = 'ia',
}

export enum HealthStatus {
  Ok = 'ok',
  Fail = 'fail',
  Skipped = 'skipped',
  Unreachable = 'unreachable',
}
