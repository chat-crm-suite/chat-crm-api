// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { HealthCheckResult } from './health.interface';

export const HEALTH_PROBES = 'HEALTH_PROBES';

export interface HealthProbe {
  /** Nombre de la comprobación (clave dentro de `checks`). */
  readonly name: string;
  /** `true` si un fallo debe tumbar la readiness con 503. */
  readonly critical: boolean;
  check(): Promise<HealthCheckResult>;
}
