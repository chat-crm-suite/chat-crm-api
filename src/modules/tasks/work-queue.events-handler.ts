// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { AnalyticsSignalEvent } from '../analytics/events/analytics.events';
import { MessageSavedEvent } from '../conversations/events/message-saved.event';
import { WorkQueueCache } from './work-queue.cache';

/**
 * Conversation changes drop the cached work-queue counts: every saved
 * message, and the `live` analytics signal that assignment, queue and
 * lifecycle changes already publish.
 */
@EventsHandler(AnalyticsSignalEvent, MessageSavedEvent)
export class WorkQueueInvalidationHandler
  implements IEventHandler<AnalyticsSignalEvent | MessageSavedEvent>
{
  constructor(private readonly cache: WorkQueueCache) {}

  async handle(event: AnalyticsSignalEvent | MessageSavedEvent): Promise<void> {
    if (event instanceof MessageSavedEvent) {
      await this.cache.invalidate(event.companyId ?? event.message.companyId);
      return;
    }
    if (event.scopes.includes('live')) await this.cache.invalidate(event.companyId);
  }
}
