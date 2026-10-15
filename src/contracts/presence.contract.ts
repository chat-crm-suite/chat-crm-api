// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

/**
 * Agent presence. `offline` is derived (no live socket for the member); the
 * member can only pick `available` or `away` manually. Time spent in each
 * state is recorded as intervals for occupancy and connected-time metrics.
 */
export const PRESENCE_STATES = ['available', 'away', 'offline'] as const;
export const PresenceStateSchema = z.enum(PRESENCE_STATES);
export type PresenceState = z.infer<typeof PresenceStateSchema>;

export const MANUAL_PRESENCE_STATES = ['available', 'away'] as const;
export const ManualPresenceStateSchema = z.enum(MANUAL_PRESENCE_STATES);
export type ManualPresenceState = z.infer<typeof ManualPresenceStateSchema>;

/** `PUT /presence` body. */
export const UpdatePresenceSchema = z.object({
  state: ManualPresenceStateSchema,
});
export type UpdatePresenceInput = z.infer<typeof UpdatePresenceSchema>;

/**
 * `GET /presence/me` and `PUT /presence` response, also the
 * `presence:changed` socket payload (to the `company:{id}` room).
 */
export const PresenceSchema = z.object({
  memberId: z.string(),
  state: PresenceStateSchema,
  since: z.coerce.date(),
});
export type Presence = z.infer<typeof PresenceSchema>;
