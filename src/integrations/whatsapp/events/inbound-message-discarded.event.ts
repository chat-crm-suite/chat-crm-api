// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundDiscardReason } from '../types/inbound-message.types';

/**
 * Domain fact published once per discarded inbound message (ticket #21).
 * Carries the provider message id, its type and the strict reason — the
 * single notice channel for unknown types and invalid payloads. Dedicated
 * log handlers and the metrics subscriber consume it (later tickets); they
 * never throw.
 */
export class InboundMessageDiscardedEvent {
  constructor(
    public readonly messageId: string,
    public readonly type: string,
    public readonly reason: InboundDiscardReason,
  ) {}
}
