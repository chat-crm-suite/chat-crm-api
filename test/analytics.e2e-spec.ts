// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { ClsModule } from 'nestjs-cls';
import { I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import type { App } from 'supertest/types';
import { join } from 'path';
import { DataSource } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import { APP_REDIS } from '@common/redis/app-redis.module';
import { clsConfig } from '@config/cls.config';
import { i18nConfig } from '@config/i18n.config';
import { loggerConfig } from '@config/logger.config';
import type {
  AgentControl,
  AgentsPerformance,
  AnalyticsReadiness,
  Case as CaseDto,
  CurrentCase,
  Delivery,
  IaStatus,
  LiveSnapshot,
  MemberRole,
  MyPerformance,
  SentimentAnalytics,
  ServiceSettings,
  SpendSummary,
  Staffing,
  Volume,
} from '@contracts';
import { WhatsAppPricingAdapter } from '@integrations/whatsapp/pricing/whatsapp-pricing.adapter';
import { IaStatusService } from '@modules/analysis/ia/ia-status.service';
import { AnalyticsController } from '@modules/analytics/analytics.controller';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import { AnalyticsCacheService } from '@modules/analytics/cache/analytics-cache.service';
import { ActivityQuery } from '@modules/analytics/queries/activity.query';
import { CasesQuery } from '@modules/analytics/queries/cases.query';
import { AnalyticsEventsService } from '@modules/analytics/realtime/analytics-events.service';
import { analyticsEventHandlers } from '@modules/analytics/realtime/analytics.events-handlers';
import { CasesController } from '@modules/cases/cases.controller';
import { CasesService } from '@modules/cases/cases.service';
import { CaseReply } from '@modules/cases/entities/case-reply.entity';
import { Case } from '@modules/cases/entities/case.entity';
import { ChannelsModule } from '@modules/channels/channels.module';
import { Channel } from '@modules/channels/entities/channel.entity';
import { CompanyModule } from '@modules/company/company.module';
import { ServiceSettingsModule } from '@modules/company/service-settings/service-settings.module';
import { Company } from '@modules/company/entities/company.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { ConversationAssignmentService } from '@modules/conversations/assignment/conversation-assignment.service';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationGateway } from '@modules/conversations/gateways/conversation.gateway';
import { ConversationAccessService } from '@modules/conversations/realtime/conversation-access.service';
import { Customer } from '@modules/customers/entities/customer.entity';
import { Message } from '@modules/message/entities/message.entity';
import { PresenceModule } from '@modules/presence/presence.module';
import { ChannelStatusReportedEvent } from '@modules/spend/events/channel-status-reported.event';
import { SpendModule } from '@modules/spend/spend.module';
import { SpendService } from '@modules/spend/spend.service';
import { User } from '@modules/users/entities/user.entity';
import { authCookie, signTestToken, testCacheModule } from './helpers/auth';
import { MemoryRedis } from './helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from './helpers/test-database.helper';

jest.setTimeout(120_000);

const redis = new MemoryRedis();

@Global()
@Module({
  providers: [{ provide: APP_REDIS, useValue: redis }],
  exports: [APP_REDIS],
})
class MemoryRedisModule {}

const activeIa: IaStatus = { status: 'active', enabled: true, available: true, breaker: 'closed' };
const disabledIa: IaStatus = { status: 'disabled', enabled: false, available: false, breaker: 'closed' };

const emitted: { room: string | null; event: string; payload: unknown }[] = [];
const fakeGateway = {
  server: {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: unknown) => emitted.push({ room: null, event, payload }),
    in: () => ({ fetchSockets: () => Promise.resolve([]) }),
  },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Analytics v2 end to end on in-memory SQLite: tenant isolation, role gates,
 * the empty-database contract (every endpoint answers its full shape), the
 * case lifecycle, idempotent channel charges, the IA gate and the cache.
 * Responses go through `ZodSerializerInterceptor`, so a payload that breaks
 * its contract fails the request.
 */
describe('Analytics v2 (e2e, sqlite)', () => {
  let app: INestApplication;
  let server: App;
  let dataSource: DataSource;
  let cases: CasesService;
  let spend: SpendService;
  let seq = 0;
  const iaStatus = { status: jest.fn<Promise<IaStatus>, []>() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        LoggerModule.forRoot(loggerConfig),
        ClsModule.forRoot(clsConfig),
        I18nModule.forRoot({
          ...i18nConfig,
          loaderOptions: { path: join(__dirname, '../src/locales/'), watch: false },
        }),
        CqrsModule.forRoot(),
        TypeOrmModule.forRoot(getTestSQLiteConfig(getSQLiteEntities())),
        TypeOrmModule.forFeature([Case, CaseReply, Conversation]),
        testCacheModule(),
        MemoryRedisModule,
        AuthModule,
        ChannelsModule,
        CompanyModule,
        ServiceSettingsModule,
        PresenceModule,
        SpendModule,
      ],
      controllers: [AnalyticsController, CasesController],
      providers: [
        AnalyticsService,
        AnalyticsCacheService,
        AnalyticsEventsService,
        CasesQuery,
        ActivityQuery,
        CasesService,
        ConversationAccessService,
        ConversationAssignmentService,
        WhatsAppPricingAdapter,
        ...analyticsEventHandlers,
        { provide: ConversationGateway, useValue: fakeGateway },
        { provide: IaStatusService, useValue: iaStatus },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(false);
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalInterceptors(new ZodSerializerInterceptor(app.get(Reflector)));
    await app.init();

    server = app.getHttpServer() as App;
    dataSource = app.get<DataSource>(getDataSourceToken());
    cases = app.get(CasesService);
    spend = app.get(SpendService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    redis.failing = false;
    emitted.length = 0;
    iaStatus.status.mockResolvedValue(activeIa);
  });

  // -------------------------------------------------------------------------
  // Seeding helpers
  // -------------------------------------------------------------------------

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  const createCompany = () => save(Company, { name: `company-${++seq}` });

  const createMember = async (company: Company, role: MemberRole, name = `user-${++seq}`) => {
    const user = await save(User, { username: name, passwordHash: 'x' });
    const member = await save(CompanyMember, {
      userId: user.id,
      companyId: company.id,
      role,
      status: 'active',
    });
    const token = signTestToken({
      sub: user.id,
      memberships: [{ cid: company.id, mid: member.id, role }],
    });
    return { user, member, cookie: authCookie(token), company };
  };

  type Session = Awaited<ReturnType<typeof createMember>>;

  /** JSON body typed with its contract (dates arrive as ISO strings). */
  const body = <T>(res: request.Response): T => res.body as T;

  const get = (session: Session, url: string) =>
    request(server).get(url).set('Cookie', session.cookie).set('x-company-id', session.company.id);
  const send = (session: Session, method: 'post' | 'put', url: string, body: object) =>
    request(server)[method](url)
      .set('Cookie', session.cookie)
      .set('x-company-id', session.company.id)
      .send(body);

  const createConversation = async (
    company: Company,
    options: { type?: Channel['type']; assignedMemberId?: string | null } = {},
  ) => {
    const channel = await save(Channel, {
      companyId: company.id,
      type: options.type ?? 'whatsapp',
      name: 'main',
      externalAccountId: `acc-${++seq}`,
      credentials: '{}',
    });
    const customer = await save(Customer, { companyId: company.id, displayName: `Cliente ${seq}` });
    return save(Conversation, {
      companyId: company.id,
      customerId: customer.id,
      channelId: channel.id,
      assignedMemberId: options.assignedMemberId ?? null,
    });
  };

  const message = (
    conversation: Conversation,
    direction: 'inbound' | 'outbound',
    at: number,
    senderMemberId?: string,
  ) =>
    save(Message, {
      companyId: conversation.companyId,
      conversationId: conversation.id,
      direction,
      senderType: direction === 'inbound' ? 'customer' : 'member',
      senderMemberId: senderMemberId ?? null,
      senderCustomerId: direction === 'inbound' ? conversation.customerId : null,
      type: 'text',
      status: direction === 'inbound' ? 'delivered' : 'sent',
      createdAt: new Date(at),
    });

  /** Customer writes at `at`; the agent answers `replyAfter` ms later. */
  const exchange = async (
    conversation: Conversation,
    agentMemberId: string,
    at: number,
    replyAfter: number,
  ) => {
    await cases.recordInbound(await message(conversation, 'inbound', at));
    await cases.recordOutbound(await message(conversation, 'outbound', at + replyAfter, agentMemberId));
  };

  // -------------------------------------------------------------------------
  // Fresh install
  // -------------------------------------------------------------------------

  describe('empty database', () => {
    it('answers every endpoint with its full shape and empty meta', async () => {
      const company = await createCompany();
      const admin = await createMember(company, 'admin');

      const live = body<LiveSnapshot>(await get(admin, '/analytics/live').expect(200));
      expect(live).toMatchObject({
        waiting: [],
        waitingTotal: 0,
        queue: { unassignedCount: 0, oldestWaitingSeconds: null },
        agents: [],
      });
      expect(live.queuePressure?.meta.status).toBe('empty');

      const me = body<MyPerformance>(await get(admin, '/analytics/me').expect(200));
      expect(me.performance.firstResponse).toEqual({
        median: null,
        p90: null,
        meta: { status: 'empty', sampleSize: 0, minimumSample: 5 },
      });
      expect(me.performance.serviceLevel.value).toBeNull();
      expect(me.firstResponseControl.meta.status).toBe('empty');

      const agents = body<AgentsPerformance>(await get(admin, '/analytics/agents?period=30d').expect(200));
      expect(agents.agents).toEqual([]);
      expect(agents.team.agentCount).toBe(0);

      const staffing = body<Staffing>(await get(admin, '/analytics/staffing').expect(200));
      expect(staffing.meta.status).toBe('empty');
      expect(staffing.hours).toHaveLength(8);
      expect(staffing.heatmap).toHaveLength(7 * 24);

      const volume = body<Volume>(await get(admin, '/analytics/volume?period=7d').expect(200));
      expect(volume.days).toHaveLength(7);
      expect(volume.meta.status).toBe('empty');

      const delivery = body<Delivery>(await get(admin, '/analytics/delivery').expect(200));
      expect(delivery.sent).toBe(0);
      expect(delivery.failed.value).toBeNull();

      const sentiment = body<SentimentAnalytics>(await get(admin, '/analytics/sentiment').expect(200));
      expect(sentiment.meta.status).toBe('empty');

      const readiness = body<AnalyticsReadiness>(await get(admin, '/analytics/readiness').expect(200));
      expect(readiness).toEqual({
        isEmpty: true,
        channels: [],
        firstMessageReceived: false,
        businessHoursConfigured: false,
        agentCount: 0,
        activeDays: 0,
      });

      const spendSummary = body<SpendSummary>(await get(admin, '/billing/spend').expect(200));
      expect(spendSummary).toMatchObject({
        totalUsd: 0,
        billableCount: 0,
        projection: null,
        budget: { monthlyBudgetUsd: null, consumedShare: null, threshold: 'none' },
        costPerResolvedCaseUsd: null,
      });

      const csv = await get(admin, `/analytics/agents/export.csv?month=2026-10`).expect(200);
      expect(csv.text.split('\r\n')[0]).toContain('member_id,name,role');
    });
  });

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('access', () => {
    it('gates endpoints by role', async () => {
      const company = await createCompany();
      const agent = await createMember(company, 'agent');
      const supervisor = await createMember(company, 'supervisor');

      await get(agent, '/analytics/agents').expect(403);
      await get(agent, '/analytics/staffing').expect(403);
      await get(agent, '/analytics/sentiment?scope=company').expect(403);
      await get(agent, '/analytics/sentiment?scope=me').expect(200);
      await get(agent, `/analytics/agents/${supervisor.member.id}/control?metric=first-response`).expect(403);
      await get(agent, `/analytics/agents/${agent.member.id}/control?metric=first-response`).expect(200);

      await get(supervisor, '/analytics/agents').expect(200);
      await get(supervisor, '/analytics/delivery').expect(403);
      await get(supervisor, '/billing/spend').expect(403);
      await send(supervisor, 'put', '/company/service-settings', { slaFirstResponseSeconds: 120 }).expect(403);
    });

    it('never mixes companies', async () => {
      const mine = await createCompany();
      const other = await createCompany();
      const admin = await createMember(mine, 'admin');
      const foreignAgent = await createMember(other, 'agent');

      const conversation = await createConversation(other, { assignedMemberId: foreignAgent.member.id });
      await exchange(conversation, foreignAgent.member.id, Date.now() - 2 * HOUR, 30_000);
      await cases.recordInbound(await message(conversation, 'inbound', Date.now() - MINUTE));

      const agents = body<AgentsPerformance>(await get(admin, '/analytics/agents').expect(200));
      expect(agents.agents).toEqual([]);
      const live = body<LiveSnapshot>(await get(admin, '/analytics/live').expect(200));
      expect(live.waitingTotal).toBe(0);
      const volume = body<Volume>(await get(admin, '/analytics/volume').expect(200));
      expect(volume.days.every((day) => day.newCases === 0)).toBe(true);

      // A foreign conversation cannot be read or closed either.
      await get(admin, `/conversations/${conversation.id}/case`).expect(403);
      await send(admin, 'post', `/conversations/${conversation.id}/close`, {}).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Case lifecycle and performance
  // -------------------------------------------------------------------------

  describe('cases and performance', () => {
    it('opens, answers, closes and reopens cases', async () => {
      const company = await createCompany();
      const agent = await createMember(company, 'agent', 'carla');
      const conversation = await createConversation(company, { assignedMemberId: agent.member.id });
      const start = Date.now() - 3 * HOUR;

      await exchange(conversation, agent.member.id, start, 90_000);
      const open = body<CurrentCase>(await get(agent, `/conversations/${conversation.id}/case`).expect(200));
      expect(open.case).toMatchObject({
        status: 'open',
        firstResponderMemberId: agent.member.id,
      });

      const closed = body<CaseDto>(await send(agent, 'post', `/conversations/${conversation.id}/close`, { note: 'ok' }).expect(200));
      expect(closed.status).toBe('closed');
      await send(agent, 'post', `/conversations/${conversation.id}/close`, {}).expect(409);

      // The customer writes again within 72 h: a reopen of the same case.
      await cases.recordInbound(await message(conversation, 'inbound', Date.now() - MINUTE));
      const reopened = body<CurrentCase>(await get(agent, `/conversations/${conversation.id}/case`).expect(200));
      expect(reopened.case?.reopenOfCaseId).toBe(closed.id);

      const me = body<MyPerformance>(await get(agent, '/analytics/me').expect(200));
      expect(me.performance).toMatchObject({
        handledCases: 2,
        resolvedCases: 1,
        firstResponse: { median: 90 },
        serviceLevel: { successes: 1, trials: 1 },
        reopenRate: { successes: 1, trials: 1 },
      });
      expect(me.performance.serviceLevel.interval?.low).toBeGreaterThan(0);
      expect(me.openCases).toBe(1);

      const live = body<LiveSnapshot>(await get(agent, '/analytics/live').expect(200));
      expect(live.waitingTotal).toBe(1);
      expect(live.waiting[0].assignee?.memberId).toBe(agent.member.id);
      expect(live.agents).toEqual([]);
      expect(live.me?.memberId).toBe(agent.member.id);
      expect(live.queuePressure).toBeNull();
    });

    it('compares agents with intervals and flags SLA breaches live', async () => {
      const company = await createCompany();
      const supervisor = await createMember(company, 'supervisor');
      const fast = await createMember(company, 'agent', 'fast');
      const slow = await createMember(company, 'agent', 'slow');
      const base = Date.now() - 6 * HOUR;

      for (let i = 0; i < 6; i++) {
        const c1 = await createConversation(company, { assignedMemberId: fast.member.id });
        await exchange(c1, fast.member.id, base + i * 10 * MINUTE, 60_000);
        const c2 = await createConversation(company, { assignedMemberId: slow.member.id });
        await exchange(c2, slow.member.id, base + i * 10 * MINUTE, 15 * MINUTE);
      }
      const waiting = await createConversation(company, { assignedMemberId: null });
      await cases.recordInbound(await message(waiting, 'inbound', Date.now() - 10 * MINUTE));

      const table = body<AgentsPerformance>(await get(supervisor, '/analytics/agents').expect(200));
      const byName = new Map(table.agents.map((row) => [row.displayName, row]));
      expect(byName.get('fast')?.serviceLevel.value).toBe(1);
      expect(byName.get('slow')?.serviceLevel.value).toBe(0);
      expect(byName.get('fast')?.firstResponse.median).toBe(60);
      expect(byName.get('slow')?.firstResponse.median).toBe(900);
      expect(table.team.agentCount).toBe(2);

      const live = body<LiveSnapshot>(await get(supervisor, '/analytics/live').expect(200));
      expect(live.queue.unassignedCount).toBe(1);
      expect(live.waiting[0]).toMatchObject({ assignee: null, slaState: 'breach' });
      expect(live.agents.map((row) => row.displayName).sort()).toEqual([
        'fast',
        'slow',
      ]);

      const control = body<AgentControl>(await get(
        supervisor,
        `/analytics/agents/${fast.member.id}/control?metric=first-response&period=30d`,
      ).expect(200));
      expect(control.chart.points).toHaveLength(30);
      expect(control.chart.meta.status).toBe('insufficient');
    });
  });

  // -------------------------------------------------------------------------
  // IA gate
  // -------------------------------------------------------------------------

  it('answers 409 for tone while the IA is off and drops tone fields', async () => {
    iaStatus.status.mockResolvedValue(disabledIa);
    const company = await createCompany();
    const admin = await createMember(company, 'admin');

    const refused = body<{ error: string }>(await get(admin, '/analytics/sentiment').expect(409));
    expect(refused.error).toBe('ia_unavailable');
    await get(admin, `/analytics/agents/${admin.member.id}/control?metric=negative-tone`).expect(409);

    const me = body<MyPerformance>(await get(admin, '/analytics/me').expect(200));
    expect(me.performance.negativeTone).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Spend
  // -------------------------------------------------------------------------

  describe('spend', () => {
    it('records each message charge once, by the channel adapter, and prices it', async () => {
      const company = await createCompany();
      const admin = await createMember(company, 'admin');
      const wa = await createConversation(company);
      const tg = await createConversation(company, { type: 'telegram' });
      const out = await message(wa, 'outbound', Date.now() - MINUTE, admin.member.id);
      const tgOut = await message(tg, 'outbound', Date.now() - MINUTE, admin.member.id);
      const report = { billable: true, pricing_model: 'PMP', category: 'marketing', type: 'regular' };

      for (let i = 0; i < 3; i++) {
        await spend.recordReport(new ChannelStatusReportedEvent(company.id, wa.id, out.id, report, new Date()));
      }
      // No pricing adapter for telegram: nothing is recorded.
      await spend.recordReport(new ChannelStatusReportedEvent(company.id, tg.id, tgOut.id, report, new Date()));

      await send(admin, 'put', '/billing/rates', {
        rates: [{ channelType: 'whatsapp', category: 'marketing', usdPerUnit: 0.5 }],
      }).expect(200);
      const summary = body<SpendSummary>(await send(admin, 'put', '/billing/budget', { monthlyBudgetUsd: 0.6 }).expect(200));

      expect(summary).toMatchObject({
        totalUsd: 0.5,
        billableCount: 1,
        budget: { monthlyBudgetUsd: 0.6, threshold: 'warning' },
      });
      expect(summary.byChannel).toHaveLength(1);
      expect(summary.byChannel[0].channelType).toBe('whatsapp');

      // The 80 % alert reached the admin once, live.
      const alerts = emitted.filter((e) => e.event === 'notification:new');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].room).toBe(`user:${admin.user.id}`);

      const paused = body<SpendSummary>(await send(admin, 'post', '/billing/pause', { paused: true }).expect(200));
      expect(paused.billableSendsPaused).toBe(true);
      expect(await spend.isBillableSendBlocked(company.id, 'whatsapp', 'template')).toBe(true);
      expect(await spend.isBillableSendBlocked(company.id, 'whatsapp', 'text')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Settings, cache and realtime
  // -------------------------------------------------------------------------

  it('measures on the business clock set by the admin', async () => {
    const company = await createCompany();
    const admin = await createMember(company, 'admin');

    const saved = await send(admin, 'put', '/company/service-settings', {
      slaFirstResponseSeconds: 120,
      businessHours: {
        timezone: 'America/Lima',
        days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }],
      },
    }).expect(200);
    expect(body<ServiceSettings>(saved).slaFirstResponseSeconds).toBe(120);

    await send(admin, 'put', '/company/service-settings', {
      businessHours: { timezone: 'Mars/Olympus', days: [] },
    }).expect(400);

    const readiness = body<AnalyticsReadiness>(await get(admin, '/analytics/readiness').expect(200));
    expect(readiness.businessHoursConfigured).toBe(true);
  });

  it('serves repeated reads from the cache until a change bumps it', async () => {
    const company = await createCompany();
    const admin = await createMember(company, 'admin');
    const touched = jest.spyOn(app.get(CasesQuery), 'touchedIn');

    await get(admin, '/analytics/agents').expect(200);
    await get(admin, '/analytics/agents').expect(200);
    expect(touched).toHaveBeenCalledTimes(1);

    const events = app.get(AnalyticsEventsService);
    await events.signal(company.id, ['cases']);
    await get(admin, '/analytics/agents').expect(200);
    expect(touched).toHaveBeenCalledTimes(2);

    // Batched announcement to the company room.
    events.flush(company.id);
    expect(emitted).toContainEqual({
      room: `company:${company.id}`,
      event: 'analytics:changed',
      payload: { companyId: company.id, scopes: ['cases'] },
    });

    // Redis down: still answers (computed directly).
    redis.failing = true;
    await get(admin, '/analytics/agents').expect(200);
    touched.mockRestore();
  });
});
