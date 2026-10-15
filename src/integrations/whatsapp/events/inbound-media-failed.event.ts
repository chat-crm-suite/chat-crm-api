// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundMediaRef } from './inbound-media-ref';

/**
 * Domain fact published once per inbound media attachment settled as `failed`
 * (ticket #24). `retryable` tells the log consumer whether the fault was a
 * transient transport failure whose retry budget ran out (warn) or a terminal
 * fault such as an oversized/expired file (error). The media correlation clump
 * and the raw error are for logs, never metric labels.
 */
export class InboundMediaFailedEvent {
  constructor(
    public readonly ref: InboundMediaRef,
    public readonly retryable: boolean,
    public readonly error: unknown,
  ) {}
}
