// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import { MemberConversationsReleasedEvent } from '../events/member-conversations-released.event';
import { ConversationsService } from '../conversations.service';

/**
 * Conversations released by a removed member go through the same path as a
 * new inbound message: auto-assign when enabled and someone is available,
 * otherwise supervisors are notified that the queue grew. Never throws: the
 * removal is already committed.
 */
@EventsHandler(MemberConversationsReleasedEvent)
export class MemberConversationsReleasedHandler
  implements IEventHandler<MemberConversationsReleasedEvent>
{
  constructor(
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MemberConversationsReleasedHandler.name);
  }

  async handle({
    companyId,
    conversationIds,
  }: MemberConversationsReleasedEvent): Promise<void> {
    for (const conversationId of conversationIds) {
      try {
        await this.conversations.ensureAssigned(conversationId, companyId);
      } catch (error) {
        this.logger.warn(
          { conversationId, error: String(error) },
          'Re-assigning a released conversation failed',
        );
      }
    }
  }
}
