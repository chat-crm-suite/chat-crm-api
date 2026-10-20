// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { AnalyticsScope, IaStatus, Presence } from '@contracts';

/**
 * Domain events consumed by the analytics realtime layer. Producers (cases,
 * presence, spend, IA, assignment) only publish on the CQRS event bus, so
 * none of them depends on the socket gateway or the analytics module.
 */

/** Something measured by `scopes` changed for the company. */
export class AnalyticsSignalEvent {
  constructor(
    public readonly companyId: string,
    public readonly scopes: readonly AnalyticsScope[],
  ) {}
}

/** A member went available/away/offline. */
export class PresenceChangedEvent {
  constructor(
    public readonly companyId: string,
    public readonly presence: Presence,
  ) {}
}

/** The IA kill switch or circuit breaker changed (global, every company). */
export class IaStatusChangedEvent {
  constructor(public readonly status: IaStatus) {}
}
