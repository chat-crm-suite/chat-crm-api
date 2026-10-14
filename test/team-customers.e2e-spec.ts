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
import {
  CreateMemberResultSchema,
  CustomerMutationResultSchema,
  CustomerRowSchema,
  paginatedSchema,
  PipelineStageSchema,
  RemoveMemberResultSchema,
  TagSchema,
  TeamTableResponseSchema,
  WorkspaceSocketEvent,
  type MemberRole,
} from '@contracts';
import { Channel } from '@modules/channels/entities/channel.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { CompanyMembersModule } from '@modules/company-members/company-members.module';
import { Company } from '@modules/company/entities/company.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationGateway } from '@modules/conversations/gateways/conversation.gateway';
import { WorkspaceChangedHandler } from '@modules/conversations/realtime/workspace-changed.handler';
import { CustomersModule } from '@modules/customers/customers.module';
import { Customer } from '@modules/customers/entities/customer.entity';
import { PipelineStage } from '@modules/customers/entities/pipeline-stage.entity';
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

const emitted: { room: string; event: string; payload: unknown }[] = [];
const fakeGateway = {
  server: {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
    }),
  },
};

/**
 * Equipo and Clientes over HTTP on in-memory SQLite, with the real guards:
 * role gates, tenant isolation, the empty-company payloads against their
 * contracts, session revocation and the realtime ping.
 */
describe('Team and customers (e2e, sqlite)', () => {
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
        testCacheModule(),
        MemoryRedisModule,
        AuthModule,
        CompanyMembersModule,
        CustomersModule,
      ],
      providers: [
        WorkspaceChangedHandler,
        { provide: ConversationGateway, useValue: fakeGateway },
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
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    redis.failing = false;
    emitted.length = 0;
  });

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  const createCompany = () => save(Company, { name: `company-${++seq}` });

  /** A signed-in member; `also` adds memberships of the same user elsewhere. */
  const createSession = async (
    company: Company,
    role: MemberRole,
    also: { company: Company; role: MemberRole }[] = [],
  ) => {
    const user = await save(User, { username: `user-${++seq}`, passwordHash: 'x' });
    const member = await save(CompanyMember, {
      userId: user.id,
      companyId: company.id,
      role,
      status: 'active',
    });
    const extra = await Promise.all(
      also.map(async (other) => ({
        cid: other.company.id,
        role: other.role,
        mid: (
          await save(CompanyMember, {
            userId: user.id,
            companyId: other.company.id,
            role: other.role,
            status: 'active',
          })
        ).id,
      })),
    );
    const token = signTestToken({
      sub: user.id,
      memberships: [{ cid: company.id, mid: member.id, role }, ...extra],
    });
    return { user, member, company, cookie: authCookie(token) };
  };
  type Session = Awaited<ReturnType<typeof createSession>>;

  const call = (
    session: Session,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    url: string,
    options: { body?: object; companyId?: string } = {},
  ) => {
    const req = request(server)[method](url)
      .set('Cookie', session.cookie)
      .set('x-company-id', options.companyId ?? session.company.id);
    return options.body ? req.send(options.body) : req;
  };

  const emptyTeamQuery = { page: 1, perPage: 10, sort: [] };

  describe('empty company', () => {
    it('answers every list endpoint with a payload that parses against its contract', async () => {
      const company = await createCompany();
      const caller = await createSession(company, 'admin');
      // The token still carries the membership; the roster itself is empty.
      await dataSource.getRepository(CompanyMember).softDelete(caller.member.id);
      const team = await call(caller, 'post', '/company-members/table', { body: emptyTeamQuery }).expect(200);
      expect(() => TeamTableResponseSchema.parse(team.body)).not.toThrow();
      expect(team.body).toMatchObject({
        items: [],
        meta: {
          totalItems: 0,
          counts: {
            byRole: { admin: 0, supervisor: 0, agent: 0 },
            byPresence: { available: 0, away: 0, offline: 0 },
          },
        },
      });

      const customers = await call(caller, 'post', '/customers/table', { body: emptyTeamQuery }).expect(200);
      expect(() => paginatedSchema(CustomerRowSchema).parse(customers.body)).not.toThrow();
      expect((customers.body as { items: unknown[] }).items).toEqual([]);

      const stages = await call(caller, 'get', '/customers/stages').expect(200);
      expect(PipelineStageSchema.array().parse(stages.body)).toEqual([]);
      const tags = await call(caller, 'get', '/customers/tags').expect(200);
      expect(TagSchema.array().parse(tags.body)).toEqual([]);
    });
  });

  describe('member routes and roles', () => {
    it('gives agents 403 on every management route but lets them read the customers table', async () => {
      const company = await createCompany();
      const agent = await createSession(company, 'agent');
      const other = await createSession(company, 'agent');
      const id = other.member.id;

      await call(agent, 'post', '/company-members/table', { body: emptyTeamQuery }).expect(403);
      await call(agent, 'post', '/company-members', {
        body: { email: 'x@acme.test', role: 'agent' },
      }).expect(403);
      await call(agent, 'patch', `/company-members/${id}`, { body: { status: 'suspended' } }).expect(403);
      await call(agent, 'delete', `/company-members/${id}`).expect(403);
      await call(agent, 'post', `/company-members/${id}/reset-password`).expect(403);

      await call(agent, 'post', '/customers/bulk-delete', {
        body: { ids: ['0198f0f0-0000-7000-8000-000000000000'] },
      }).expect(403);
      await call(agent, 'delete', '/customers/0198f0f0-0000-7000-8000-000000000000').expect(403);
      await call(agent, 'post', '/customers/table', { body: emptyTeamQuery }).expect(200);
      expect(await dataSource.getRepository(CompanyMember).count()).toBe(2);
    });

    it('lets a supervisor add agents but never an admin or another supervisor', async () => {
      const company = await createCompany();
      const supervisor = await createSession(company, 'supervisor');

      const forbidden = await call(supervisor, 'post', '/company-members', {
        body: { email: 'boss@acme.test', role: 'admin' },
      }).expect(403);
      expect((forbidden.body as { code: string }).code).toBe('team_grant');
      await call(supervisor, 'post', '/company-members', {
        body: { email: 'sup@acme.test', role: 'supervisor' },
      }).expect(403);

      const created = await call(supervisor, 'post', '/company-members', {
        body: { email: 'agent@acme.test', role: 'agent', firstName: 'Ana' },
      }).expect(201);
      const result = CreateMemberResultSchema.parse(created.body);
      expect(result.outcome).toBe('created');
      expect(result.initialPassword).toHaveLength(14);
      expect(result.member).toMatchObject({ role: 'agent', email: 'agent@acme.test' });
      expect(
        emitted.some(
          (item) =>
            item.room === `company:${company.id}` && item.event === WorkspaceSocketEvent.TeamChanged,
        ),
      ).toBe(true);
    });

    it('removes a member over HTTP: conversations released, old token refused', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin');
      const agent = await createSession(company, 'agent');
      const channel = await save(Channel, {
        companyId: company.id,
        type: 'whatsapp',
        name: 'main',
        externalAccountId: 'acc',
        credentials: '{}',
      });
      const customer = await save(Customer, { companyId: company.id, displayName: 'Cliente' });
      const conversation = await save(Conversation, {
        companyId: company.id,
        customerId: customer.id,
        channelId: channel.id,
        assignedMemberId: agent.member.id,
      });

      const removed = await call(admin, 'delete', `/company-members/${agent.member.id}`).expect(200);
      expect(RemoveMemberResultSchema.parse(removed.body)).toEqual({ releasedConversations: 1 });
      expect(
        (await dataSource.getRepository(Conversation).findOneByOrFail({ id: conversation.id }))
          .assignedMemberId,
      ).toBeNull();

      const stale = await call(agent, 'get', '/company-members').expect(401);
      expect((stale.body as { code: string }).code).toBe('token_stale');

      const table = await call(admin, 'post', '/company-members/table', { body: emptyTeamQuery }).expect(200);
      expect(TeamTableResponseSchema.parse(table.body).items.map((row) => row.id)).toEqual([
        admin.member.id,
      ]);
    });

    it('protects yourself and the last admin', async () => {
      const company = await createCompany();
      const admin = await createSession(company, 'admin');

      await call(admin, 'delete', `/company-members/${admin.member.id}`).expect(403);
      await call(admin, 'patch', `/company-members/${admin.member.id}`, { body: { role: 'agent' } }).expect(403);
      await call(admin, 'post', `/company-members/${admin.member.id}/reset-password`).expect(403);
    });
  });

  describe('customers tenant isolation', () => {
    it('answers 404 for a customer of another company, even for a user in both', async () => {
      const a = await createCompany();
      const b = await createCompany();
      const both = await createSession(a, 'admin', [{ company: b, role: 'admin' }]);
      const inB = await save(Customer, { companyId: b.id, displayName: 'Only in B', phoneNumber: '+51911111111' });

      // Acting as A, B's customer does not exist.
      await call(both, 'patch', `/customers/${inB.id}`, { body: { displayName: 'x' } }).expect(404);
      await call(both, 'delete', `/customers/${inB.id}`).expect(404);
      await call(both, 'put', `/customers/${inB.id}/tags`, { body: { tagIds: [] } }).expect(404);
      const bulk = await call(both, 'post', '/customers/bulk-delete', { body: { ids: [inB.id] } }).expect(200);
      expect(bulk.body).toEqual({ deleted: 0 });
      expect((await call(both, 'get', '/customers/search?q=Only').expect(200)).body).toEqual([]);
      expect((await call(both, 'get', '/customers').expect(200)).body).toEqual([]);

      // Acting as B it is there.
      const inBTable = await call(both, 'post', '/customers/table', {
        body: emptyTeamQuery,
        companyId: b.id,
      }).expect(200);
      expect((inBTable.body as { items: { id: string }[] }).items.map((row) => row.id)).toEqual([inB.id]);
    });

    it('refuses an x-company-id the session does not belong to', async () => {
      const a = await createCompany();
      const b = await createCompany();
      const session = await createSession(a, 'admin');
      await save(Customer, { companyId: b.id, displayName: 'Secret' });

      await call(session, 'post', '/customers/table', { body: emptyTeamQuery, companyId: b.id }).expect(403);
      await call(session, 'get', '/customers/search?q=Secret', { companyId: b.id }).expect(403);
      await call(session, 'post', '/company-members/table', { body: emptyTeamQuery, companyId: b.id }).expect(403);
    });
  });

  describe('customers flow', () => {
    it('creates, conflicts, deletes and restores, with static routes ahead of :phone', async () => {
      const company = await createCompany();
      const stage = await save(PipelineStage, { companyId: company.id, name: 'Lead', position: 1 });
      const supervisor = await createSession(company, 'supervisor');

      const created = await call(supervisor, 'post', '/customers', {
        body: { displayName: 'Ana', phoneNumber: '51999111222', pipelineStageId: stage.id },
      }).expect(201);
      const first = CustomerMutationResultSchema.parse(created.body);
      expect(first.restored).toBe(false);
      expect(first.customer.stage?.name).toBe('Lead');

      const conflict = await call(supervisor, 'post', '/customers', {
        body: { phoneNumber: '+51999111222' },
      }).expect(409);
      expect(conflict.body).toMatchObject({ code: 'customer_exists', customerId: first.customer.id });

      await call(supervisor, 'delete', `/customers/${first.customer.id}`).expect(200);
      const restored = await call(supervisor, 'post', '/customers', {
        body: { phoneNumber: '+51999111222', displayName: 'Ana B' },
      }).expect(201);
      expect(CustomerMutationResultSchema.parse(restored.body)).toMatchObject({
        restored: true,
        customer: { id: first.customer.id, displayName: 'Ana B' },
      });

      const tag = (await call(supervisor, 'post', '/customers/tags', { body: { name: 'vip' } }).expect(201))
        .body as { id: string };
      await call(supervisor, 'post', '/customers/tags', { body: { name: 'vip' } }).expect(409);
      const tagged = await call(supervisor, 'put', `/customers/${first.customer.id}/tags`, {
        body: { tagIds: [tag.id] },
      }).expect(200);
      expect(CustomerRowSchema.parse(tagged.body).tags.map((item) => item.name)).toEqual(['vip']);

      const byTag = await call(supervisor, 'post', '/customers/table', {
        body: { ...emptyTeamQuery, tagId: [tag.id] },
      }).expect(200);
      expect((byTag.body as { items: unknown[] }).items).toHaveLength(1);

      // `/customers/tags` and `/customers/stages` are not phone lookups.
      expect(((await call(supervisor, 'get', '/customers/tags').expect(200)).body as unknown[])).toHaveLength(1);
      expect(((await call(supervisor, 'get', '/customers/stages').expect(200)).body as unknown[])).toHaveLength(1);
      const search = await call(supervisor, 'get', '/customers/search?q=Ana').expect(200);
      expect((search.body as { id: string }[]).map((row) => row.id)).toEqual([first.customer.id]);

      expect(
        emitted.some(
          (item) =>
            item.room === `company:${company.id}` &&
            item.event === WorkspaceSocketEvent.CustomersChanged,
        ),
      ).toBe(true);
    });
  });
});
