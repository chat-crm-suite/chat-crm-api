// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * The active company profile changed (`PATCH /company/me`): connected
 * clients of that company refresh it (`company:updated`).
 */
export class CompanyUpdatedEvent {
  constructor(public readonly companyId: string) {}
}
