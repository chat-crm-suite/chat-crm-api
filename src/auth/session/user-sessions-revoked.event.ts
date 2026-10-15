// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Published when a user's memberships changed: realtime transports drop the
 * user's live connections so they reconnect with fresh claims.
 */
export class UserSessionsRevokedEvent {
  constructor(public readonly userId: string) {}
}
