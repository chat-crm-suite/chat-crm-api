// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import type { ConversationMessage } from '@contracts';

export class BroadcastConversationMessageCommand extends Command<{
  id: string;
}> {
  constructor(
    public readonly id: string,
    public readonly payload: ConversationMessage,
    public readonly conversationId?: string,
  ) {
    super();
  }
}
