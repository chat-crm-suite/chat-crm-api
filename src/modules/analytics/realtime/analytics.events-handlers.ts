// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';

import { MessageAnalyzedEvent } from '../../analysis/events/message-analyzed.event';
import { Conversation } from '../../conversations/entities/conversation.entity';
import {
  AnalyticsSignalEvent,
  IaStatusChangedEvent,
  PresenceChangedEvent,
} from '../events/analytics.events';
import { AnalyticsEventsService } from './analytics-events.service';

@EventsHandler(AnalyticsSignalEvent)
export class AnalyticsSignalHandler implements IEventHandler<AnalyticsSignalEvent> {
  constructor(private readonly events: AnalyticsEventsService) {}

  handle({ companyId, scopes }: AnalyticsSignalEvent): Promise<void> {
    return this.events.signal(companyId, scopes);
  }
}

@EventsHandler(PresenceChangedEvent)
export class PresenceChangedHandler implements IEventHandler<PresenceChangedEvent> {
  constructor(private readonly events: AnalyticsEventsService) {}

  async handle({ companyId, presence }: PresenceChangedEvent): Promise<void> {
    this.events.emitPresence(companyId, presence);
    await this.events.signal(companyId, ['presence', 'live']);
  }
}

@EventsHandler(IaStatusChangedEvent)
export class IaStatusChangedHandler implements IEventHandler<IaStatusChangedEvent> {
  constructor(private readonly events: AnalyticsEventsService) {}

  handle({ status }: IaStatusChangedEvent): Promise<void> {
    return this.events.emitIaStatus(status);
  }
}

/** A new tone result changes the tone metrics of its company. */
@EventsHandler(MessageAnalyzedEvent)
export class MessageAnalyzedAnalyticsHandler implements IEventHandler<MessageAnalyzedEvent> {
  constructor(
    private readonly events: AnalyticsEventsService,
    private readonly dataSource: DataSource,
  ) {}

  async handle({ conversationId }: MessageAnalyzedEvent): Promise<void> {
    if (!conversationId) return;
    const conversation = await this.dataSource.getRepository(Conversation).findOne({
      where: { id: conversationId },
      select: { id: true, companyId: true },
    });
    if (conversation) await this.events.signal(conversation.companyId, ['sentiment']);
  }
}

export const analyticsEventHandlers = [
  AnalyticsSignalHandler,
  PresenceChangedHandler,
  IaStatusChangedHandler,
  MessageAnalyzedAnalyticsHandler,
];
