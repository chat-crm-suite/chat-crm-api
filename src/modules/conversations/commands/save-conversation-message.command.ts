// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { MessageSenderType } from '@contracts';
import type { SaveConversationMessageContent } from '../conversations.service';

/**
 * The `save-message` queue job (inbound webhook messages): the conversation
 * (`room`), who wrote it and the parsed content to persist.
 */
export interface SaveMessageJob {
  room: string;
  companyId?: string;
  sender: { id: string; type: MessageSenderType };
  msg: SaveConversationMessageContent;
}

export class SaveConversationMessageCommand {
  constructor(public readonly data: SaveMessageJob) {}
}
