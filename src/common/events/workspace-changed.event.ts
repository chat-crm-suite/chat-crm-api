// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { WorkspaceSocketEvent } from '../../contracts/index';

/**
 * A company-wide table (team, customers) changed. Producers only publish on
 * the CQRS bus; the conversations module relays it to the `company:{id}`
 * socket room, so no producer depends on the gateway.
 */
export class WorkspaceChangedEvent {
  constructor(
    public readonly companyId: string,
    public readonly event: WorkspaceSocketEvent,
    /** Optional ids of the affected rows; clients refetch either way. */
    public readonly ids?: readonly string[],
  ) {}
}
