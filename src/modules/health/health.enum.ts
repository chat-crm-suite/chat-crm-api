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
