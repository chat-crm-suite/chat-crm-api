// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InboundMediaRef } from './inbound-media-ref';

/**
 * Domain fact published once per inbound media attachment flipped to `ready`
 * (ticket #24). Carries the media correlation clump (message, attachment,
 * provider media, attachment type); dedicated log and metrics consumers read
 * it, and the metrics label only uses `ref.type`.
 */
export class InboundMediaEnrichedEvent {
  constructor(public readonly ref: InboundMediaRef) {}
}
