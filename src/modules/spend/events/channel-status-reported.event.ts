// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * A provider status callback for one of our outbound messages carried cost
 * information (`report`, raw and provider-specific). The spend module asks
 * the channel's pricing adapter to read it; producers never interpret it.
 */
export class ChannelStatusReportedEvent {
  constructor(
    public readonly companyId: string,
    public readonly conversationId: string,
    public readonly messageId: string,
    public readonly report: unknown,
    public readonly occurredAt: Date,
  ) {}
}
