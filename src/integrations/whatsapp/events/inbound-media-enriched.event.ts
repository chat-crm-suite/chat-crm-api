// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Domain fact published once per inbound media attachment flipped to `ready`
 * (ticket #24). Carries the correlation ids (message, attachment, provider
 * media) plus the attachment type; dedicated log and metrics consumers read
 * it, and the metrics label only uses `type`.
 */
export class InboundMediaEnrichedEvent {
  constructor(
    public readonly messageId: string,
    public readonly attachmentId: string,
    public readonly mediaId: string,
    public readonly type: string,
  ) {}
}
