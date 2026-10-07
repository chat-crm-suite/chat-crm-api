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
