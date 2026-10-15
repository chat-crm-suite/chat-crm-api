// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { TenantContext } from '../../auth/index';
import {
  IA_UNAVAILABLE_ERROR,
  type AgentControl,
  type AgentControlQuery,
  type AgentsPerformance,
  type AnalyticsRangeQuery,
  type AnalyticsReadiness,
  type ChannelFilter,
  type Delivery,
  type LiveSnapshot,
  type MyPerformance,
  type PerformanceExportQuery,
  type SentimentAnalytics,
  type SentimentAnalyticsQuery,
  type Staffing,
  type Volume,
} from '../../contracts/index';
import { durationHistogram } from '../../lib/stats/index';
import { startOfZonedDay, zonedDateKey } from '../../lib/zoned-time';
import { IaStatusService } from '../analysis/ia/ia-status.service';
import { ServiceSettingsService } from '../company/service-settings/service-settings.service';
import { PresenceService } from '../presence/presence.service';
import type { MeasureContext, TimeRange } from './analytics.types';
import { AnalyticsCacheService } from './cache/analytics-cache.service';
import { computeLiveSnapshot, shapeLiveSnapshot } from './calculators/live.calculator';
import {
  computePerformance,
  hasActivity,
  memberControlChart,
  teamReference,
  type PerformanceInput,
} from './calculators/performance.calculator';
import {
  STAFFING_HISTORY_DAYS,
  computeDelivery,
  computeSentiment,
  computeStaffing,
  computeVolume,
} from './calculators/trends.calculator';
import { toPerformanceCsv } from './export/performance-csv';
import { ActivityQuery } from './queries/activity.query';
import { CasesQuery } from './queries/cases.query';
import { isClosedRange, resolveRange } from './range';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const TTL = {
  live: 15_000,
  current: 60_000,
  closed: 24 * HOUR_MS,
  staffing: HOUR_MS,
} as const;

/**
 * Orchestrates every analytics read: settings → (cache) → queries →
 * calculators. Each public method answers one endpoint with its full contract
 * shape, also on an empty database.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly casesQuery: CasesQuery,
    private readonly activity: ActivityQuery,
    private readonly settings: ServiceSettingsService,
    private readonly presence: PresenceService,
    private readonly ia: IaStatusService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  async live(tenant: TenantContext, channel: ChannelFilter): Promise<LiveSnapshot> {
    const context = await this.context(tenant.companyId, channel);
    const iaAvailable = await this.iaAvailable();

    const snapshot = await this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['live', 'presence', 'sentiment'],
        key: { endpoint: 'live', channel, iaAvailable },
        ttlMs: TTL.live,
      },
      async () => {
        const now = context.now;
        const dayStart = startOfZonedDay(now, context.timezone);
        const [members, openCases, openedLastHour, answeredToday, toneToday] = await Promise.all([
          this.activity.members(tenant.companyId),
          this.casesQuery.open(tenant.companyId, channel),
          this.casesQuery.openedSince(tenant.companyId, now - HOUR_MS, channel),
          this.casesQuery.touchedIn(tenant.companyId, { from: dayStart, to: now + 1 }, channel),
          iaAvailable
            ? this.activity.tone(tenant.companyId, { from: dayStart, to: now + 1 }, channel)
            : Promise.resolve(null),
        ]);
        const presence = await this.presence.current(
          tenant.companyId,
          members.map((member) => member.memberId),
        );
        const answered = answeredToday.filter((row) => row.firstResponseAt !== null);

        return computeLiveSnapshot({
          context,
          members,
          openCases,
          arrivalsLastHour: openedLastHour.length,
          recentWaits: answered
            .filter((row) => (row.firstResponseAt as number) >= now - HOUR_MS)
            .map((row) => ((row.firstResponseAt as number) - row.openedAt) / 1000),
          answeredToday: answered,
          presence,
          toneToday,
        });
      },
    );

    return shapeLiveSnapshot(snapshot, tenant);
  }

  async me(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<MyPerformance> {
    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);
    const iaAvailable = await this.iaAvailable();

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases', 'presence', 'sentiment'],
        key: { endpoint: 'me', memberId: tenant.memberId, range: rangeKey(query, context), channel: query.channel, iaAvailable },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () => {
        const { input, result } = await this.performance(context, range, iaAvailable);
        const index = result.rows.findIndex((row) => row.memberId === tenant.memberId);
        if (index < 0) throw new NotFoundException('Member not found in this company');

        const row = result.rows[index];
        const sample = result.samples[index];
        const open = await this.casesQuery.open(tenant.companyId, query.channel);
        const member = input.members[index];

        return {
          range: info,
          slaSeconds: context.slaSeconds,
          performance: row,
          firstResponseHistogram: durationHistogram(sample.firstResponses.map((r) => r.seconds)),
          firstResponseControl: memberControlChart('first-response', sample, context, range),
          team: teamReference(result.rows.filter((r) => r.role === 'agent' || hasActivity(r))),
          openCases: open.filter((c) => c.assignedMemberId === tenant.memberId).length,
          capacity: member.capacity ?? context.defaultCapacity,
        };
      },
    );
  }

  async agents(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<AgentsPerformance> {
    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);
    const iaAvailable = await this.iaAvailable();

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases', 'presence', 'sentiment'],
        key: { endpoint: 'agents', range: rangeKey(query, context), channel: query.channel, iaAvailable },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () => {
        const { result } = await this.performance(context, range, iaAvailable);
        const agents = result.rows.filter((row) => row.role === 'agent' || hasActivity(row));
        return {
          range: info,
          slaSeconds: context.slaSeconds,
          agents,
          team: teamReference(agents),
        };
      },
    );
  }

  async control(
    tenant: TenantContext,
    memberId: string,
    query: AgentControlQuery,
  ): Promise<AgentControl> {
    if (tenant.role === 'agent' && tenant.memberId !== memberId) {
      throw new ForbiddenException('Agents can only see their own charts');
    }
    const iaAvailable = await this.iaAvailable();
    if (query.metric === 'negative-tone' && !iaAvailable) throw iaUnavailable();

    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases', 'presence', 'sentiment'],
        key: { endpoint: 'control', memberId, metric: query.metric, range: rangeKey(query, context), channel: query.channel, iaAvailable },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () => {
        const { input, result } = await this.performance(context, range, iaAvailable);
        const index = input.members.findIndex((member) => member.memberId === memberId);
        if (index < 0) throw new NotFoundException('Member not found in this company');

        return {
          range: info,
          member: {
            memberId,
            displayName: input.members[index].displayName,
          },
          metric: query.metric,
          chart: memberControlChart(query.metric, result.samples[index], context, range),
        };
      },
    );
  }

  async staffing(tenant: TenantContext, channel: ChannelFilter): Promise<Staffing> {
    const context = await this.context(tenant.companyId, channel);

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases', 'presence'],
        key: { endpoint: 'staffing', channel, hour: Math.floor(context.now / HOUR_MS) },
        ttlMs: TTL.staffing,
      },
      async () => {
        const since = context.now - STAFFING_HISTORY_DAYS * DAY_MS;
        const members = await this.activity.members(tenant.companyId);
        const [opened, closed, presence] = await Promise.all([
          this.casesQuery.openedSince(tenant.companyId, since, channel),
          this.casesQuery.closedSince(tenant.companyId, since, channel),
          this.presence.current(tenant.companyId, members.map((m) => m.memberId)),
        ]);
        const availableAgents = [...presence.values()].filter((p) => p.state === 'available').length;

        return computeStaffing({ context, opened, closed, availableAgents });
      },
    );
  }

  async volume(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<Volume> {
    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases'],
        key: { endpoint: 'volume', range: rangeKey(query, context), channel: query.channel },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () => {
        const [cases, messages, backlogAtStart] = await Promise.all([
          this.casesQuery.touchedIn(tenant.companyId, range, query.channel),
          this.activity.messages(tenant.companyId, range, query.channel),
          this.casesQuery.openAt(tenant.companyId, range.from, query.channel),
        ]);
        const customers = [
          ...new Set(
            cases
              .filter((row) => row.openedAt >= range.from && row.openedAt < range.to)
              .map((row) => row.customerId),
          ),
        ];
        const firstCaseAt = await this.casesQuery.firstCaseAt(tenant.companyId, customers);

        return computeVolume({ context, range, rangeInfo: info, cases, messages, backlogAtStart, firstCaseAt });
      },
    );
  }

  async delivery(tenant: TenantContext, query: AnalyticsRangeQuery): Promise<Delivery> {
    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases'],
        key: { endpoint: 'delivery', range: rangeKey(query, context), channel: query.channel },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () =>
        computeDelivery(await this.activity.delivery(tenant.companyId, range, query.channel), info),
    );
  }

  async sentiment(tenant: TenantContext, query: SentimentAnalyticsQuery): Promise<SentimentAnalytics> {
    if (query.scope === 'company' && tenant.role === 'agent') {
      throw new ForbiddenException('Agents can only see the tone of their own cases');
    }
    if (!(await this.iaAvailable())) throw iaUnavailable();

    const context = await this.context(tenant.companyId, query.channel);
    const { range, info } = resolveRange(query, context.timezone, context.now);

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['sentiment', 'cases'],
        key: {
          endpoint: 'sentiment',
          scope: query.scope,
          memberId: query.scope === 'me' ? tenant.memberId : null,
          range: rangeKey(query, context),
          channel: query.channel,
        },
        ttlMs: this.ttlFor(range, context.now),
      },
      async () => {
        const rows = await this.activity.tone(tenant.companyId, range, query.channel);
        const scoped =
          query.scope === 'me' ? rows.filter((row) => row.ownerMemberId === tenant.memberId) : rows;
        return computeSentiment(scoped, context, range, info, query.scope);
      },
    );
  }

  async readiness(tenant: TenantContext): Promise<AnalyticsReadiness> {
    const context = await this.context(tenant.companyId, 'all');

    return this.cache.wrap(
      {
        companyId: tenant.companyId,
        scopes: ['cases'],
        key: { endpoint: 'readiness' },
        ttlMs: TTL.current,
      },
      async () => {
        const [channels, hasInbound, members, opened] = await Promise.all([
          this.activity.channels(tenant.companyId),
          this.activity.hasInbound(tenant.companyId),
          this.activity.members(tenant.companyId),
          this.casesQuery.openedTimestamps(tenant.companyId, context.now - 90 * DAY_MS),
        ]);
        const activeDays = new Set(opened.map((instant) => zonedDateKey(instant, context.timezone))).size;

        return {
          isEmpty: !hasInbound && opened.length === 0,
          channels: channels.map((channel) => ({
            channelType: channel.type,
            connected: channel.status === 'active',
          })),
          firstMessageReceived: hasInbound,
          businessHoursConfigured: context.hours !== null,
          agentCount: members.filter((member) => member.role === 'agent').length,
          activeDays,
        };
      },
    );
  }

  /** Monthly performance table as CSV (payroll / offline review). */
  async exportCsv(tenant: TenantContext, query: PerformanceExportQuery): Promise<string> {
    const report = await this.agents(tenant, { period: '30d', month: query.month, channel: query.channel });
    return toPerformanceCsv(report);
  }

  private async performance(context: MeasureContext, range: TimeRange, iaAvailable: boolean) {
    const companyId = context.companyId;
    const [members, cases, replies, transfers, presence, tone, reopenedIds] = await Promise.all([
      this.activity.members(companyId),
      this.casesQuery.touchedIn(companyId, range, context.channel),
      this.casesQuery.repliesIn(companyId, range, context.channel),
      this.activity.transfers(companyId, range),
      this.activity.presence(companyId, range),
      iaAvailable ? this.activity.tone(companyId, range, context.channel) : Promise.resolve(null),
      this.casesQuery.reopenedIds(companyId, range.from),
    ]);

    const input: PerformanceInput = {
      context,
      range,
      members,
      cases,
      replies,
      transfers,
      presence,
      tone,
      reopenedIds,
    };
    return { input, result: computePerformance(input) };
  }

  private async context(companyId: string, channel: ChannelFilter): Promise<MeasureContext> {
    const settings = await this.settings.get(companyId);
    return {
      companyId,
      channel,
      timezone: settings.timezone,
      hours: settings.businessHours,
      slaSeconds: settings.slaFirstResponseSeconds,
      targetShare: settings.slaTargetShare,
      defaultCapacity: settings.defaultCapacity,
      now: Date.now(),
    };
  }

  private async iaAvailable(): Promise<boolean> {
    return (await this.ia.status()).available;
  }

  private ttlFor(range: TimeRange, now: number): number {
    return isClosedRange(range, now) ? TTL.closed : TTL.current;
  }
}

/**
 * Cache identity of a range. Open ranges end "now", so the exact instant
 * would never repeat: the period plus the local day is stable, while the TTL
 * and the scope versions keep the result fresh.
 */
function rangeKey(
  query: { period?: string; month?: string },
  context: MeasureContext,
): string {
  return query.month ?? `${query.period ?? '7d'}@${zonedDateKey(context.now, context.timezone)}`;
}

function iaUnavailable(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: IA_UNAVAILABLE_ERROR,
    message: 'Sentiment analysis is disabled or unavailable',
  });
}
