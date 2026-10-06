// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import type { Message } from '../../../modules/message/entities/message.entity';
import { SendConversationMessageDto } from '../../../modules/conversations/dto/send-conversation-message.dto';

/**
 * T5: the queue hands the agent send to the outbound pipeline (save pending,
 * then Graph). Handled in the WhatsApp module to keep the module graph
 * acyclic; the processor only dispatches.
 */
export class SendAgentMessageCommand extends Command<Message | null> {
  constructor(
    public readonly data: SendConversationMessageDto,
    /** BullMQ `attemptsMade`: 0 on the first run, >0 after a stalled retry. */
    public readonly attemptsMade = 0,
  ) {
    super();
  }
}
