// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ChannelsService } from '@modules/channels/channels.service';
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
import { DataSource, IsNull } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import { APP_REDIS } from '@common/redis/app-redis.module';
import { clsConfig } from '@config/cls.config';
import { i18nConfig } from '@config/i18n.config';
import { loggerConfig } from '@config/logger.config';
import {
  CompanyMemberResponseSchema,
  ConversationAssignmentEntrySchema,
  ConversationLifecycleResultSchema,
  ConversationListItemSchema,
  ConversationSocketEvent,
  StartConversationResultSchema,
  SyncTemplatesResultSchema,
  TaskSchema,
  TaskSocketEvent,
  TemplateGroupSchema,
  TemplateSchema,
  WorkQueueResponseSchema,
  type MemberRole,
} from '@contracts';
import { toWhatsAppPayload } from '@integrations/whatsapp/outbound/whatsapp-payload';
import { buildWhatsAppTemplateSend } from '@integrations/whatsapp/templates/whatsapp-template.mapper';
import { CasesController } from '@modules/cases/cases.controller';
import { CasesService } from '@modules/cases/cases.service';
import { Case } from '@modules/cases/entities/case.entity';
import { CaseReply } from '@modules/cases/entities/case-reply.entity';
import { Channel } from '@modules/channels/entities/channel.entity';
import { MessageTemplate } from '@modules/channels/entities/message-template.entity';
import type { ResolvedOutgoing } from '@modules/channels/ports/channel-adapter.port';
import { ChannelAdapterRegistry } from '@modules/channels/ports/channel-adapter.registry';
import type { RemoteTemplate } from '@modules/channels/ports/channel-template.port';
import { ChannelTemplateRegistry } from '@modules/channels/ports/channel-template.registry';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { CompanyMembersModule } from '@modules/company-members/company-members.module';
import { Company } from '@modules/company/entities/company.entity';
import { SentimentService } from '@modules/analysis/sentiment/sentiment.service';
import { ConversationAssignmentNotifier } from '@modules/conversations/assignment/conversation-assignment.notifier';
import { ConversationAssignmentService } from '@modules/conversations/assignment/conversation-assignment.service';
import { ConversationRepository } from '@modules/conversations/conversation.repository';
import { ConversationsController } from '@modules/conversations/conversations.controller';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { ConversationAssignment } from '@modules/conversations/entities/conversation-assignment.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { MessageSavedEvent } from '@modules/conversations/events/message-saved.event';
import { ConversationGateway } from '@modules/conversations/gateways/conversation.gateway';
import { ConversationInboundReopenHandler } from '@modules/conversations/lifecycle/conversation-inbound-reopen.handler';
import { ConversationLifecycleController } from '@modules/conversations/lifecycle/conversation-lifecycle.controller';
import { ConversationLifecycleService } from '@modules/conversations/lifecycle/conversation-lifecycle.service';
import { ConversationStartController } from '@modules/conversations/lifecycle/conversation-start.controller';
import { ConversationStartService } from '@modules/conversations/lifecycle/conversation-start.service';
import { ConversationListService } from '@modules/conversations/listing/conversation-list.service';
import { AgentMessageSender } from '@modules/conversations/outbound/agent-message-sender.service';
import { OutgoingMediaService } from '@modules/conversations/outbound/outgoing-media.service';
import { ConversationAccessService } from '@modules/conversations/realtime/conversation-access.service';
import { ConversationFanoutService } from '@modules/conversations/realtime/conversation-fanout.service';
import { ConversationSendContextService } from '@modules/conversations/send-context/conversation-send-context.service';
import { ConversationUploadsService } from '@modules/conversations/uploads/conversation-uploads.service';
import { Customer } from '@modules/customers/entities/customer.entity';
import { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { Message } from '@modules/message/entities/message.entity';
import { MessageRepository } from '@modules/message/message.repository';
import { MessageService } from '@modules/message/message.service';
import { Task } from '@modules/tasks/entities/task.entity';
import { TasksController, WorkQueueController } from '@modules/tasks/tasks.controller';
import { TasksService } from '@modules/tasks/tasks.service';
import { WorkQueueCache } from '@modules/tasks/work-queue.cache';
import { WorkQueueInvalidationHandler } from '@modules/tasks/work-queue.events-handler';
import { WorkQueueService } from '@modules/tasks/work-queue.service';
import { ConversationTemplateController } from '@modules/templates/conversation-template.controller';
import { TemplatesController } from '@modules/templates/templates.controller';
import { TemplatesService } from '@modules/templates/templates.service';
import { User } from '@modules/users/entities/user.entity';
import { authCookie, signTestToken, testCacheModule } from './helpers/auth';
import { MemoryRedis } from './helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from './helpers/test-database.helper';

jest.setTimeout(120_000);

const HOUR = 60 * 60 * 1000;
const redis = new MemoryRedis();

@Global()
@Module({
  providers: [{ provide: APP_REDIS, useValue: redis }],
  exports: [APP_REDIS],
})
class MemoryRedisModule {}

/** Socket.io-like fake: records each emit with the union of its rooms. */
const emitted: { rooms: string[]; event: string; payload: unknown }[] = [];
const operator = (rooms: string[]) => ({
  to: (room: string) => operator([...rooms, room]),
  except: () => operator(rooms),
  emit: (event: string, payload: unknown) => {
    emitted.push({ rooms, event, payload });
    return true;
  },
});
const fakeGateway = {
  server: { to: (room: string) => operator([room]) },
  revokeConversationAccess: () => Promise.resolve(),
};
const notifier = {
  notifyAssigned: jest.fn().mockResolvedValue(undefined),
  notifyUnassigned: jest.fn().mockResolvedValue(undefined),
};

/** Provider stand-ins: the adapter records every send, the template list is per test. */
const sends: { channelId: string; recipient: string; message: ResolvedOutgoing }[] = [];
const adapter = {
  type: 'whatsapp' as const,
  uploadMedia: jest.fn(),
  send: jest.fn((channelId: string, recipient: string, message: ResolvedOutgoing) => {
    sends.push({ channelId, recipient, message });
    return Promise.resolve({ ok: true as const, externalId: `wamid-${sends.length}` });
  }),
};
let remoteTemplates: RemoteTemplate[] = [];
const templateProvider = {
  type: 'whatsapp' as const,
  listRemote: jest.fn(() => Promise.resolve({ ok: true as const, templates: remoteTemplates })),
  buildSend: buildWhatsAppTemplateSend,
};

const remote = (overrides: Partial<RemoteTemplate> = {}): RemoteTemplate => ({
  externalId: `ext-${overrides.name ?? 'welcome'}`,
  name: 'welcome',
  language: 'es',
  category: 'utility',
  status: 'approved',
  statusReason: null,
  components: [
    { type: 'header', format: 'text', text: 'Hola {{1}}' },
    { type: 'body', text: 'Tu pedido {{1}} llega el {{2}}.' },
    { type: 'footer', text: 'Gracias' },
  ],
  variables: [
    { key: '1', component: 'header', example: 'Ana' },
    { key: '1', component: 'body', example: '#123' },
    { key: '2', component: 'body', example: 'lunes' },
  ],
  ...overrides,
});

/**
 * Inbox v2 over HTTP on in-memory SQLite with the real guards: lifecycle,
 * scoped listings, tasks and the work queue, templates and "Nuevo chat".
 * The provider is faked at the channel ports; everything else is real.
 */
describe('Inbox v2 (e2e, sqlite)', () => {
  let app: INestApplication;
  let server: App;
  let dataSource: DataSource;
  let seq = 0;

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
        TypeOrmModule.forFeature([
          Case,
          CaseReply,
          Channel,
          CompanyMember,
          Conversation,
          ConversationAssignment,
          Message,
          MessageAttachment,
          MessageTemplate,
          Task,
        ]),
        testCacheModule(),
        MemoryRedisModule,
        AuthModule,
        CompanyMembersModule,
      ],
      controllers: [
        ConversationsController,
        ConversationLifecycleController,
        ConversationStartController,
        CasesController,
        TasksController,
        WorkQueueController,
        TemplatesController,
        ConversationTemplateController,
      ],
      providers: [
        ConversationsService,
        ConversationAccessService,
        ConversationAssignmentService,
        ConversationFanoutService,
        ConversationListService,
        ConversationSendContextService,
        ConversationLifecycleService,
        ConversationStartService,
        ConversationInboundReopenHandler,
        AgentMessageSender,
        CasesService,
        MessageRepository,
        MessageService,
        TasksService,
        WorkQueueService,
        WorkQueueCache,
        WorkQueueInvalidationHandler,
        TemplatesService,
        ChannelAdapterRegistry,
        ChannelsService,
        ChannelTemplateRegistry,
        { provide: ConversationGateway, useValue: fakeGateway },
        { provide: ConversationAssignmentNotifier, useValue: notifier },
        { provide: ConversationRepository, useValue: { listForMember: () => Promise.resolve([]) } },
        { provide: OutgoingMediaService, useValue: { prepare: () => Promise.resolve(null) } },
        { provide: ConversationUploadsService, useValue: {} },
        { provide: SentimentService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(false);
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalInterceptors(new ZodSerializerInterceptor(app.get(Reflector)));
    await app.init();

    app.get(ChannelAdapterRegistry).register(adapter);
    app.get(ChannelTemplateRegistry).register(templateProvider);

    server = app.getHttpServer() as App;
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    emitted.length = 0;
    sends.length = 0;
    remoteTemplates = [];
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  const createCompany = () => save(Company, { name: `company-${++seq}` });

  const createSession = async (company: Company, role: MemberRole, firstName?: string) => {
    const user = await save(User, {
      username: `user-${++seq}`,
      passwordHash: 'x',
      firstName: firstName ?? null,
    } as Partial<User>);
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
    return { user, member, company, cookie: authCookie(token) };
  };
  type Session = Awaited<ReturnType<typeof createSession>>;

  const call = (
    session: Session,
    method: 'get' | 'post' | 'patch',
    url: string,
    body?: object,
  ) => {
    const req = request(server)[method](url)
      .set('Cookie', session.cookie)
      .set('x-company-id', session.company.id);
    return body ? req.send(body) : req;
  };

  const createChannel = (company: Company) =>
    save(Channel, {
      companyId: company.id,
      type: 'whatsapp',
      name: `WhatsApp ${++seq}`,
      externalAccountId: `phone-${seq}`,
      credentials: 'encrypted',
      status: 'active',
    });

  const createCustomer = (company: Company, displayName = `Customer ${++seq}`) =>
    save(Customer, {
      companyId: company.id,
      displayName,
      phoneNumber: `+5199900${String(++seq).padStart(4, '0')}`,
    });

  const createConversation = async (
    company: Company,
    options: { owner?: CompanyMember; lastInboundAt?: Date | null; channel?: Channel } = {},
  ) => {
    const channel = options.channel ?? (await createChannel(company));
    const customer = await createCustomer(company);
    const conversation = await save(Conversation, {
      companyId: company.id,
      customerId: customer.id,
      channelId: channel.id,
      status: 'open',
      priority: 'low',
      lastInboundAt: options.lastInboundAt === undefined ? new Date() : (options.lastInboundAt ?? undefined),
      assignedMemberId: options.owner?.id ?? null,
    });
    if (options.owner) {
      await save(ConversationAssignment, {
        conversationId: conversation.id,
        memberId: options.owner.id,
        reason: 'manual',
        assignedAt: new Date(Date.now() - HOUR),
      });
    }
    return { conversation, channel, customer };
  };

  const messages = () => app.get(MessageService);

  const saveMessage = (
    conversation: Conversation,
    direction: 'inbound' | 'outbound',
    sender: { memberId?: string; customerId?: string },
    createdAt?: Date,
  ) =>
    messages()
      .saveMessage({
        companyId: conversation.companyId,
        conversationId: conversation.id,
        type: 'text',
        direction,
        senderType: direction === 'inbound' ? 'customer' : 'member',
        senderMemberId: sender.memberId ?? null,
        senderCustomerId: sender.customerId ?? null,
        body: direction === 'inbound' ? 'hola' : 'respuesta',
        status: direction === 'inbound' ? 'delivered' : 'sent',
      })
      .then(async (message) => {
        if (createdAt) {
          await dataSource.getRepository(Message).update({ id: message.id }, { createdAt });
          message.createdAt = createdAt;
        }
        return message;
      });

  const reload = (id: string) =>
    dataSource.getRepository(Conversation).findOneByOrFail({ id });

  const eventsNamed = (event: string) => emitted.filter((entry) => entry.event === event);

  // ---------------------------------------------------------------------------
  // Empty database
  // ---------------------------------------------------------------------------

  describe('empty company', () => {
    it('answers every new list endpoint with a full-shaped empty payload', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');

      const queue = await call(agent, 'get', '/work-queue').expect(200);
      expect(WorkQueueResponseSchema.parse(queue.body)).toMatchObject({
        tasks: [],
        signals: [],
        counts: { tasksOpen: 0, tasksOverdue: 0, unassigned: 0, needsResponse: 0, windowExpiring: 0 },
      });

      for (const url of [
        '/conversations',
        '/conversations/unassigned',
        '/conversations/needs-response',
        '/conversations/list',
      ]) {
        const res = await call(agent, 'get', url).expect(200);
        expect(ConversationListItemSchema.array().parse(res.body)).toEqual([]);
      }
      const tasks = await call(agent, 'get', '/tasks').expect(200);
      expect(TaskSchema.array().parse(tasks.body)).toEqual([]);
      const templates = await call(agent, 'get', '/templates').expect(200);
      expect(TemplateSchema.array().parse(templates.body)).toEqual([]);
      const groups = await call(agent, 'get', '/templates/groups').expect(200);
      expect(TemplateGroupSchema.array().parse(groups.body)).toEqual([]);

      const supervisor = await createSession(company, 'supervisor');
      const team = await call(supervisor, 'get', '/work-queue?scope=all').expect(200);
      expect(WorkQueueResponseSchema.parse(team.body).counts.unassigned).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scoped listings
  // ---------------------------------------------------------------------------

  describe('listings', () => {
    it('refuses scope=all and other agents lists to agents, and serves supervisors', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const peer = await createSession(company, 'agent');
      const supervisor = await createSession(company, 'supervisor');
      await createConversation(company, { owner: peer.member });
      await createConversation(company, { owner: agent.member });

      await call(agent, 'get', '/conversations?scope=all').expect(403);
      await call(agent, 'get', '/tasks?scope=all').expect(403);
      await call(agent, 'get', `/tasks?assigneeId=${peer.member.id}`).expect(403);
      await call(agent, 'get', '/work-queue?scope=all').expect(403);
      await call(agent, 'get', `/conversations/list?agentId=${peer.user.id}`).expect(403);

      const mine = await call(agent, 'get', '/conversations').expect(200);
      expect(ConversationListItemSchema.array().parse(mine.body)).toHaveLength(1);

      const all = await call(supervisor, 'get', '/conversations?scope=all').expect(200);
      const items = ConversationListItemSchema.array().parse(all.body);
      expect(items).toHaveLength(2);
      const peers = await call(
        supervisor,
        'get',
        `/conversations?scope=all&assigneeId=${peer.member.id}`,
      ).expect(200);
      expect(ConversationListItemSchema.array().parse(peers.body)).toEqual([
        expect.objectContaining({
          assignee: expect.objectContaining({ memberId: peer.member.id }) as unknown,
          channel: expect.objectContaining({ type: 'whatsapp' }) as unknown,
          status: 'open',
          transfer: null,
        }),
      ]);
    });

    it('derives the reply window and the unread count of each item', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const lastInboundAt = new Date(Date.now() - 2 * HOUR);
      const { conversation, customer } = await createConversation(company, {
        owner: agent.member,
        lastInboundAt,
      });
      await saveMessage(conversation, 'inbound', { customerId: customer.id });
      await saveMessage(conversation, 'inbound', { customerId: customer.id });

      const [item] = ConversationListItemSchema.array().parse(
        (await call(agent, 'get', '/conversations').expect(200)).body,
      );
      expect(item.unread).toBe(2);
      expect(item.windowExpiresAt).not.toBeNull();
      expect(item.lastInboundAt).not.toBeNull();
    });

    it('adds workload and presence to the member picker on request', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      await createConversation(company, { owner: agent.member });

      const plain = await call(agent, 'get', '/company-members').expect(200);
      expect(CompanyMemberResponseSchema.array().parse(plain.body)[0].openConversations).toBeUndefined();

      const res = await call(agent, 'get', '/company-members?withWorkload=true').expect(200);
      expect(CompanyMemberResponseSchema.array().parse(res.body)).toEqual([
        expect.objectContaining({ id: agent.member.id, openConversations: 1, presence: 'offline' }),
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('resolves (case closed, owner released) and an inbound message reopens it', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const { conversation, customer } = await createConversation(company, { owner: agent.member });
      const inbound = await saveMessage(conversation, 'inbound', { customerId: customer.id });
      await app.get(CasesService).recordInbound(inbound);

      const res = await call(agent, 'post', `/conversations/${conversation.id}/resolve`, {
        note: 'listo',
      }).expect(200);
      const result = ConversationLifecycleResultSchema.parse(res.body);
      expect(result).toMatchObject({ status: 'closed', assignee: null });
      expect(result.case).toMatchObject({ status: 'closed', closedByMemberId: agent.member.id });

      const resolved = await reload(conversation.id);
      expect(resolved).toMatchObject({ status: 'closed', closedByMemberId: agent.member.id });
      expect(resolved.closedAt).toBeTruthy();
      const history = await dataSource
        .getRepository(ConversationAssignment)
        .find({ where: { conversationId: conversation.id }, order: { assignedAt: 'ASC' } });
      expect(history.map((row) => row.reason)).toEqual(['manual', 'release']);
      expect(history.every((row) => row.unassignedAt)).toBe(true);
      expect(eventsNamed(ConversationSocketEvent.StatusChanged)).toEqual([
        expect.objectContaining({
          rooms: [`conversation:${conversation.id}`, `company:${company.id}`],
          payload: expect.objectContaining({ status: 'closed', previousStatus: 'open' }) as unknown,
        }),
      ]);

      // The customer writes again: open, and announced as such.
      emitted.length = 0;
      const again = await saveMessage(conversation, 'inbound', { customerId: customer.id });
      await app.get(ConversationInboundReopenHandler).handle(new MessageSavedEvent(again));
      expect((await reload(conversation.id)).status).toBe('open');
      expect(eventsNamed(ConversationSocketEvent.StatusChanged)[0]?.payload).toMatchObject({
        status: 'open',
        previousStatus: 'closed',
        byMemberId: null,
      });
    });

    it('keeps a pending conversation pending when the agent replies', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const { conversation } = await createConversation(company, { owner: agent.member });

      const res = await call(agent, 'post', `/conversations/${conversation.id}/pending`, {}).expect(200);
      expect(ConversationLifecycleResultSchema.parse(res.body)).toMatchObject({
        status: 'pending',
        assignee: { memberId: agent.member.id },
      });

      const reply = await saveMessage(conversation, 'outbound', { memberId: agent.member.id });
      await app.get(ConversationInboundReopenHandler).handle(new MessageSavedEvent(reply));
      await app.get(ConversationsService).updateLastMessage(conversation.id, reply.id, 'outbound');
      expect((await reload(conversation.id)).status).toBe('pending');

      await app.get(ConversationsService).updateLastMessage(conversation.id, reply.id, 'inbound');
      expect((await reload(conversation.id)).status).toBe('open');
    });

    it('transfers with a note, labels it until the new owner replies, and keeps the history', async () => {
      const company = await createCompany();
      const ana = await createSession(company, 'agent', 'Ana');
      const bruno = await createSession(company, 'agent', 'Bruno');
      const outsider = await createSession(company, 'agent');
      const { conversation } = await createConversation(company, { owner: ana.member });

      await call(outsider, 'post', `/conversations/${conversation.id}/transfer`, {
        memberId: outsider.member.id,
      }).expect(403);
      await call(ana, 'post', `/conversations/${conversation.id}/transfer`, {
        memberId: ana.member.id,
      }).expect(409);

      const res = await call(ana, 'post', `/conversations/${conversation.id}/transfer`, {
        memberId: bruno.member.id,
        note: 'Cliente VIP',
      }).expect(200);
      expect(ConversationLifecycleResultSchema.parse(res.body).assignee).toMatchObject({
        memberId: bruno.member.id,
        name: 'Bruno',
      });
      expect(notifier.notifyAssigned).toHaveBeenCalledWith(conversation.id, bruno.member.id);

      const [item] = ConversationListItemSchema.array().parse(
        (await call(bruno, 'get', '/conversations').expect(200)).body,
      );
      expect(item.transfer).toMatchObject({
        fromMemberId: ana.member.id,
        fromName: 'Ana',
        note: 'Cliente VIP',
      });

      const entries = ConversationAssignmentEntrySchema.array().parse(
        (await call(bruno, 'get', `/conversations/assignments/${conversation.id}`).expect(200)).body,
      );
      expect(entries[0]).toMatchObject({
        memberId: bruno.member.id,
        memberName: 'Bruno',
        reason: 'transfer',
        note: 'Cliente VIP',
        assignedByMemberId: ana.member.id,
        unassignedAt: null,
      });

      await saveMessage(conversation, 'outbound', { memberId: bruno.member.id }, new Date(Date.now() + 60_000));
      const [after] = ConversationListItemSchema.array().parse(
        (await call(bruno, 'get', '/conversations').expect(200)).body,
      );
      expect(after.transfer).toBeNull();
    });

    it('sets and clears the priority (owner, admin, supervisor only)', async () => {
      const company = await createCompany();
      const owner = await createSession(company, 'agent');
      const peer = await createSession(company, 'agent');
      const { conversation } = await createConversation(company, { owner: owner.member });

      await call(peer, 'patch', `/conversations/${conversation.id}/priority`, { priority: 'high' }).expect(403);
      await call(owner, 'patch', `/conversations/${conversation.id}/priority`, { priority: 'nope' }).expect(400);

      const set = await call(owner, 'patch', `/conversations/${conversation.id}/priority`, {
        priority: 'urgent',
      }).expect(200);
      expect(ConversationListItemSchema.parse(set.body)).toMatchObject({ id: conversation.id, priority: 'urgent' });

      const cleared = await call(owner, 'patch', `/conversations/${conversation.id}/priority`, {
        priority: null,
      }).expect(200);
      expect(ConversationListItemSchema.parse(cleared.body).priority).toBeNull();
      expect((await reload(conversation.id)).priority).toBeNull();
    });

    it('releases to the queue and keeps POST /close as an alias of resolve', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const { conversation, customer } = await createConversation(company, { owner: agent.member });

      const released = await call(agent, 'post', `/conversations/${conversation.id}/release`, {
        note: 'fin de turno',
      }).expect(200);
      expect(ConversationLifecycleResultSchema.parse(released.body)).toMatchObject({
        status: 'open',
        assignee: null,
      });
      expect(notifier.notifyUnassigned).toHaveBeenCalledWith(conversation.id, company.id);
      const queue = ConversationListItemSchema.array().parse(
        (await call(agent, 'get', '/conversations/unassigned').expect(200)).body,
      );
      expect(queue.map((item) => item.id)).toEqual([conversation.id]);

      await call(agent, 'post', `/conversations/${conversation.id}/close`, {}).expect(409);
      await app
        .get(CasesService)
        .recordInbound(await saveMessage(conversation, 'inbound', { customerId: customer.id }));
      const closed = await call(agent, 'post', `/conversations/${conversation.id}/close`, {}).expect(200);
      expect(closed.body).toMatchObject({ status: 'closed' });
      expect((await reload(conversation.id)).status).toBe('closed');

      const reopened = await call(agent, 'post', `/conversations/${conversation.id}/reopen`, {}).expect(200);
      expect(ConversationLifecycleResultSchema.parse(reopened.body)).toMatchObject({
        status: 'open',
        case: { status: 'open' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Reply window
  // ---------------------------------------------------------------------------

  describe('reply window', () => {
    it('fails a free-form send outside the window without calling the provider', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const { conversation } = await createConversation(company, {
        owner: agent.member,
        lastInboundAt: new Date(Date.now() - 25 * HOUR),
      });

      const result = await app.get(AgentMessageSender).send({
        room: conversation.id,
        companyId: company.id,
        sender: { id: agent.member.id, type: 'member' },
        clientMessageId: 'late-1',
        msg: { type: 'text', text: 'hola' },
      });

      expect(result).toMatchObject({ status: 'failed', errorCode: 'reply_window_closed' });
      expect(adapter.send).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  describe('tasks', () => {
    it('scopes visibility and assignment by role and announces every change', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin', 'Admin');
      const agent = await createSession(company, 'agent', 'Ana');
      const peer = await createSession(company, 'agent');
      const { conversation, customer } = await createConversation(company, { owner: agent.member });

      await call(agent, 'post', '/tasks', {
        title: 'Para otro',
        assigneeMemberId: peer.member.id,
      }).expect(403);

      const own = TaskSchema.parse(
        (await call(agent, 'post', '/tasks', { title: 'Llamar', conversationId: conversation.id }).expect(201))
          .body,
      );
      expect(own).toMatchObject({
        assignee: { memberId: agent.member.id, name: 'Ana' },
        createdBy: { memberId: agent.member.id },
        conversation: { id: conversation.id, channelType: 'whatsapp' },
        customer: { id: customer.id },
        status: 'open',
        priority: 'medium',
      });

      const assigned = TaskSchema.parse(
        (
          await call(admin, 'post', '/tasks', {
            title: 'Seguimiento',
            assigneeMemberId: agent.member.id,
            dueAt: new Date(Date.now() - HOUR).toISOString(),
          }).expect(201)
        ).body,
      );
      expect(assigned.overdue).toBe(true);
      const changed = eventsNamed(TaskSocketEvent.Changed).at(-1);
      expect(changed?.rooms).toEqual([`company:${company.id}`, `user:${agent.user.id}`]);
      expect(changed?.payload).toMatchObject({ taskId: assigned.id, action: 'created' });

      const adminOwn = TaskSchema.parse(
        (await call(admin, 'post', '/tasks', { title: 'Mía' }).expect(201)).body,
      );

      // Overdue first (due date), then the one without a due date.
      const mine = TaskSchema.array().parse((await call(agent, 'get', '/tasks').expect(200)).body);
      expect(mine.map((task) => task.id)).toEqual([assigned.id, own.id]);
      const all = TaskSchema.array().parse(
        (await call(admin, 'get', '/tasks?scope=all').expect(200)).body,
      );
      expect(all).toHaveLength(3);

      await call(agent, 'patch', `/tasks/${adminOwn.id}`, { title: 'x' }).expect(404);
      await call(agent, 'patch', `/tasks/${own.id}`, { assigneeMemberId: peer.member.id }).expect(403);

      const done = TaskSchema.parse(
        (await call(agent, 'post', `/tasks/${own.id}/complete`).expect(200)).body,
      );
      expect(done.status).toBe('done');
      expect(done.completedAt).not.toBeNull();
      expect(eventsNamed(TaskSocketEvent.Changed).at(-1)?.payload).toMatchObject({
        taskId: own.id,
        action: 'completed',
      });

      const queue = WorkQueueResponseSchema.parse(
        (await call(agent, 'get', '/work-queue').expect(200)).body,
      );
      expect(queue.tasks.map((task) => task.id)).toEqual([assigned.id]);
      expect(queue.counts).toMatchObject({ tasksOpen: 1, tasksOverdue: 1 });
    });

    it('derives queue, needs-response and window signals for the right audience', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const peer = await createSession(company, 'agent');
      const supervisor = await createSession(company, 'supervisor');

      // Unassigned: everyone sees the shared queue.
      await createConversation(company);
      // Peer's conversation waiting 30 minutes and its window closing in 1 hour.
      const waiting = await createConversation(company, {
        owner: peer.member,
        lastInboundAt: new Date(Date.now() - 23 * HOUR),
      });
      await saveMessage(
        waiting.conversation,
        'inbound',
        { customerId: waiting.customer.id },
        new Date(Date.now() - 30 * 60_000),
      );
      await dataSource
        .getRepository(Conversation)
        .update(
          { id: waiting.conversation.id },
          { lastMessageAt: new Date(Date.now() - 30 * 60_000), lastInboundAt: new Date(Date.now() - 23 * HOUR) },
        );

      const mine = WorkQueueResponseSchema.parse(
        (await call(agent, 'get', '/work-queue').expect(200)).body,
      );
      expect(mine.signals.map((signal) => signal.kind)).toEqual(['unassigned']);
      expect(mine.counts).toMatchObject({ unassigned: 1, needsResponse: 0, windowExpiring: 0 });

      const team = WorkQueueResponseSchema.parse(
        (await call(supervisor, 'get', '/work-queue?scope=all').expect(200)).body,
      );
      expect(team.signals.map((signal) => signal.kind).sort()).toEqual(
        ['needs_response', 'unassigned', 'window_expiring'].sort(),
      );
      expect(team.counts).toMatchObject({ unassigned: 1, needsResponse: 1, windowExpiring: 1 });
      expect(team.signals.find((signal) => signal.kind === 'window_expiring')).toMatchObject({
        conversationId: waiting.conversation.id,
        assignee: { memberId: peer.member.id },
      });

      const narrowed = WorkQueueResponseSchema.parse(
        (await call(supervisor, 'get', `/work-queue?scope=all&assigneeId=${peer.member.id}`).expect(200))
          .body,
      );
      expect(narrowed.counts.unassigned).toBe(0);
      expect(narrowed.signals.every((signal) => signal.kind !== 'unassigned')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Templates and "Nuevo chat"
  // ---------------------------------------------------------------------------

  describe('channel health', () => {
    it('marks a channel down, shows it in the list, refuses sends and comes back up', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const { conversation, channel } = await createConversation(company, {
        owner: agent.member,
        lastInboundAt: new Date(Date.now() - 30 * HOUR),
      });
      const channels = app.get(ChannelsService);
      const reason = 'El token de acceso de WhatsApp venció o fue revocado.';

      expect(await channels.markChannelDown(channel.id, reason)).toBe(true);
      // Already down: no second transition (and no second socket event).
      expect(await channels.markChannelDown(channel.id, reason)).toBe(false);

      const [item] = ConversationListItemSchema.array().parse(
        (await call(agent, 'get', '/conversations').expect(200)).body,
      );
      expect(item.channel).toMatchObject({ id: channel.id, status: 'error', statusReason: reason });

      const refused = await call(agent, 'post', `/conversations/${conversation.id}/template`, {
        templateId: 'any',
        params: {},
      }).expect(409);
      expect(refused.body).toMatchObject({ code: 'channel_unavailable', message: reason });
      await expect(channels.assertSendable(channel.id)).rejects.toMatchObject({
        response: { code: 'channel_unavailable' },
      });
      expect(sends).toHaveLength(0);

      expect(await channels.markChannelUp(channel.id)).toBe(true);
      await expect(channels.assertSendable(channel.id)).resolves.toBeUndefined();
      const [back] = ConversationListItemSchema.array().parse(
        (await call(agent, 'get', '/conversations').expect(200)).body,
      );
      expect(back.channel).toMatchObject({ status: 'active', statusReason: null });
    });
  });

  describe('templates', () => {
    it('syncs (upsert + disable), hides drafts from agents and limits settings to admins', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin');
      const agent = await createSession(company, 'agent');
      const channel = await createChannel(company);
      const other = await createChannel(company);

      await call(agent, 'post', '/templates/sync', { channelId: channel.id }).expect(403);

      remoteTemplates = [remote(), remote({ name: 'promo', status: 'pending', category: 'marketing' })];
      const first = SyncTemplatesResultSchema.parse(
        (await call(admin, 'post', '/templates/sync', { channelId: channel.id }).expect(200)).body,
      );
      expect(first).toMatchObject({ total: 2, created: 2, updated: 0, disabled: 0 });
      expect(first.statusChanges.map((change) => [change.name, change.from, change.to])).toEqual([
        ['welcome', null, 'approved'],
        ['promo', null, 'pending'],
      ]);
      await call(admin, 'post', '/templates/sync', { channelId: other.id }).expect(200);

      remoteTemplates = [remote()];
      const second = SyncTemplatesResultSchema.parse(
        (await call(admin, 'post', '/templates/sync', { channelId: channel.id }).expect(200)).body,
      );
      expect(second).toMatchObject({ total: 1, created: 0, updated: 1, disabled: 1 });
      expect(second.statusChanges).toEqual([
        expect.objectContaining({ name: 'promo', from: 'pending', to: 'disabled' }),
      ]);

      const groups = TemplateGroupSchema.array().parse(
        (await call(admin, 'get', '/templates/groups').expect(200)).body,
      );
      expect(groups.find((group) => group.name === 'welcome')).toMatchObject({ multiChannel: true });

      const forAgent = TemplateSchema.array().parse((await call(agent, 'get', '/templates').expect(200)).body);
      expect(forAgent.map((template) => template.name)).toEqual(['welcome', 'welcome']);

      const target = forAgent.find((template) => template.channelId === channel.id)!;
      await call(agent, 'patch', `/templates/${target.id}/settings`, { visibleToAgents: false }).expect(403);
      const updated = TemplateSchema.parse(
        (
          await call(admin, 'patch', `/templates/${target.id}/settings`, {
            visibleToAgents: false,
            variableLabels: { 'body:1': 'Pedido' },
          }).expect(200)
        ).body,
      );
      expect(updated.visibleToAgents).toBe(false);
      expect(updated.variables.find((variable) => variable.key === '1' && variable.component === 'body'))
        .toMatchObject({ label: 'Pedido', example: '#123' });
      const hidden = TemplateSchema.array().parse((await call(agent, 'get', '/templates').expect(200)).body);
      expect(hidden.map((template) => template.channelId)).toEqual([other.id]);
    });

    it('sends a template in a conversation with the Graph payload and the rendered body', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin');
      const agent = await createSession(company, 'agent');
      const { conversation, channel, customer } = await createConversation(company, {
        owner: agent.member,
        lastInboundAt: new Date(Date.now() - 30 * HOUR),
      });
      remoteTemplates = [remote()];
      await call(admin, 'post', '/templates/sync', { channelId: channel.id }).expect(200);
      const [template] = TemplateSchema.array().parse((await call(agent, 'get', '/templates').expect(200)).body);

      const missing = await call(agent, 'post', `/conversations/${conversation.id}/template`, {
        templateId: template.id,
        params: { 'header:1': 'Ana' },
      }).expect(400);
      expect(missing.body).toMatchObject({ code: 'template_params_missing' });

      const res = await call(agent, 'post', `/conversations/${conversation.id}/template`, {
        templateId: template.id,
        params: { 'header:1': 'Ana', 'body:1': '#987', 'body:2': 'martes' },
        clientMessageId: 'tpl-1',
      }).expect(201);
      expect(res.body).toMatchObject({ conversationId: conversation.id });

      const stored = await dataSource.getRepository(Message).findOneByOrFail({
        id: (res.body as { messageId: string }).messageId,
      });
      expect(stored).toMatchObject({
        type: 'template',
        templateId: template.id,
        status: 'sent',
        body: 'Hola Ana\n\nTu pedido #987 llega el martes.\n\nGracias',
      });

      expect(sends).toHaveLength(1);
      expect(toWhatsAppPayload(sends[0].recipient, sends[0].message)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: customer.phoneNumber!.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: 'welcome',
          language: { code: 'es' },
          components: [
            { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: '#987' },
                { type: 'text', text: 'martes' },
              ],
            },
          ],
        },
      });
    });

    it('starts a conversation: template required while the window is closed', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin');
      const agent = await createSession(company, 'agent');
      const channel = await createChannel(company);
      const customer = await createCustomer(company, 'Lucía');
      remoteTemplates = [remote()];
      await call(admin, 'post', '/templates/sync', { channelId: channel.id }).expect(200);
      const [template] = TemplateSchema.array().parse((await call(admin, 'get', '/templates').expect(200)).body);

      const refused = await call(admin, 'post', '/conversations/start', {
        customerId: customer.id,
        channelId: channel.id,
      }).expect(409);
      expect(refused.body).toMatchObject({ code: 'reply_window_closed' });
      expect(await dataSource.getRepository(Conversation).count()).toBe(0);

      await call(agent, 'post', '/conversations/start', {
        customerId: customer.id,
        channelId: channel.id,
        assigneeMemberId: admin.member.id,
        template: { templateId: template.id, params: { 'header:1': 'a', 'body:1': 'b', 'body:2': 'c' } },
      }).expect(403);

      const res = await call(admin, 'post', '/conversations/start', {
        customerId: customer.id,
        channelId: channel.id,
        assigneeMemberId: agent.member.id,
        template: { templateId: template.id, params: { 'header:1': 'Lucía', 'body:1': '#1', 'body:2': 'hoy' } },
        task: { title: 'Confirmar entrega' },
      }).expect(201);
      const started = StartConversationResultSchema.parse(res.body);
      expect(started).toMatchObject({
        created: true,
        conversation: {
          status: 'open',
          customer: { id: customer.id, displayName: 'Lucía' },
          assignee: { memberId: agent.member.id },
        },
      });
      expect(started.taskId).not.toBeNull();
      expect(started.messageId).not.toBeNull();
      expect(sends.map((send) => send.message.type)).toEqual(['template']);
      expect(eventsNamed(ConversationSocketEvent.Created)).toHaveLength(1);
      expect(notifier.notifyAssigned).toHaveBeenCalledWith(started.conversation.id, agent.member.id);

      const task = await dataSource.getRepository(Task).findOneByOrFail({ id: started.taskId! });
      expect(task).toMatchObject({
        assigneeMemberId: agent.member.id,
        createdByMemberId: admin.member.id,
        conversationId: started.conversation.id,
        customerId: customer.id,
      });
      const active = await dataSource
        .getRepository(ConversationAssignment)
        .findOneByOrFail({ conversationId: started.conversation.id, unassignedAt: IsNull() });
      expect(active).toMatchObject({ memberId: agent.member.id, reason: 'manual' });

      // Starting again reuses the conversation.
      const again = StartConversationResultSchema.parse(
        (
          await call(admin, 'post', '/conversations/start', {
            customerId: customer.id,
            channelId: channel.id,
            assigneeMemberId: agent.member.id,
            template: { templateId: template.id, params: { 'header:1': 'x', 'body:1': 'y', 'body:2': 'z' } },
          }).expect(201)
        ).body,
      );
      expect(again).toMatchObject({ created: false, taskId: null });
      expect(again.conversation.id).toBe(started.conversation.id);
    });
  });
});
