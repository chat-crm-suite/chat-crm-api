// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundContentType } from '../types/inbound-message.types';

/**
 * Domain fact published once per normalized inbound message (ticket #24).
 * Carries the provider message id and its type so the metrics subscriber can
 * count received messages by `type` only — the id is for correlation, never a
 * metric label.
 */
export class InboundMessageReceivedEvent {
  constructor(
    public readonly messageId: string,
    public readonly type: InboundContentType,
  ) {}
}
