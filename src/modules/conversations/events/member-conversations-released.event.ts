// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * A removed member's open conversations lost their owner (committed). The
 * conversations module hands them back to the auto-assign / queue flow.
 */
export class MemberConversationsReleasedEvent {
  constructor(
    public readonly companyId: string,
    public readonly conversationIds: readonly string[],
  ) {}
}
