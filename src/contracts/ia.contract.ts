// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * T2: manual kill switch contract. `POST /admin/ia/toggle` takes the desired
 * state and answers with the state that ended up persisted in Redis.
 */
export const IaToggleSchema = z.object({
  enabled: z.boolean(),
});
export type IaToggle = z.infer<typeof IaToggleSchema>;

export const IaStateSchema = z.object({
  enabled: z.boolean(),
});
export type IaState = z.infer<typeof IaStateSchema>;

export const CIRCUIT_BREAKER_STATES = ['closed', 'open', 'half-open'] as const;
export const CircuitBreakerStateSchema = z.enum(CIRCUIT_BREAKER_STATES);

/**
 * `active` = on and reachable; `disabled` = kill switch off;
 * `unavailable` = on but the circuit breaker is open (IA service down).
 */
export const IA_STATUSES = ['active', 'disabled', 'unavailable'] as const;
export const IaStatusKindSchema = z.enum(IA_STATUSES);

/**
 * `GET /ia/status` (any member) and the `ia:status:changed` socket payload.
 * Sentiment features render only while `available` is true
 * (`enabled && breaker !== 'open'`).
 */
export const IaStatusSchema = z.object({
  status: IaStatusKindSchema,
  enabled: z.boolean(),
  available: z.boolean(),
  breaker: CircuitBreakerStateSchema,
});
export type IaStatus = z.infer<typeof IaStatusSchema>;
