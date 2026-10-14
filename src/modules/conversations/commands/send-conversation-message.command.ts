// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import type { SendConversationMessageInput } from '@contracts';

/**
 * The `send-message` queue job: the validated socket payload plus what the
 * gateway resolved from the session (company and acting member). The
 * recipient is not here on purpose: the sender resolves it from the
 * conversation.
 */
export interface AgentSendJob extends SendConversationMessageInput {
  companyId: string;
  sender: { id: string; type: 'member' };
}

export class SendConversationMessageCommand extends Command<{
  conversationId: string;
}> {
  constructor(public readonly data: AgentSendJob) {
    super();
  }
}
