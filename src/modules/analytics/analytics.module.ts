// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { IaModule } from '../analysis/ia/ia.module';
import { ServiceSettingsModule } from '../company/service-settings/service-settings.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PresenceModule } from '../presence/presence.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsCacheService } from './cache/analytics-cache.service';
import { ActivityQuery } from './queries/activity.query';
import { CasesQuery } from './queries/cases.query';
import { AnalyticsEventsService } from './realtime/analytics-events.service';
import { analyticsEventHandlers } from './realtime/analytics.events-handlers';

/**
 * Analytics v2 (`/analytics/*`): layered as queries (portable SQL, rows only)
 * → calculators (pure statistics) → service (cache + orchestration), plus the
 * realtime layer that turns domain events into batched `analytics:changed`.
 */
@Module({
  imports: [
    CqrsModule,
    ConversationsModule,
    PresenceModule,
    ServiceSettingsModule,
    IaModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsCacheService,
    AnalyticsEventsService,
    CasesQuery,
    ActivityQuery,
    ...analyticsEventHandlers,
  ],
})
export class AnalyticsModule {}
