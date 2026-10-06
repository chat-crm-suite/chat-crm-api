// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { registerAs } from '@nestjs/config';

export default registerAs('health', () => ({
  // IA es opcional: si no responde, la readiness la marca 'unreachable'
  // pero no tumba el endpoint.
  iaUrl: process.env.IA_URL,
  iaTimeoutMs: parseInt(process.env.HEALTH_IA_TIMEOUT_MS || '2000', 10),
  probeTtlMs: parseInt(process.env.HEALTH_PROBE_TTL_MS || '10000', 10),
}));
