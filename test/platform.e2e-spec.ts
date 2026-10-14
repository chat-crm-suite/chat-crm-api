// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { ClsModule } from 'nestjs-cls';
import { I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import { APP_REDIS } from '@common/redis/app-redis.module';
import { clsConfig } from '@config/cls.config';
import { i18nConfig } from '@config/i18n.config';
import { loggerConfig } from '@config/logger.config';
import type {
  AuthUser,
  CompanyProfile,
  MemberRole,
  PlatformCompanyTableResponse,
  PlatformCreateCompanyResult,
  PlatformDeleteCompanyResult,
  PlatformStatus,
} from '@contracts';
import { CompanyModule } from '@modules/company/company.module';
import { Company } from '@modules/company/entities/company.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { ATTACHMENT_STORAGE_ROOT } from '@modules/media/attachment-storage.service';
import { PlatformModule } from '@modules/platform/platform.module';
import { User } from '@modules/users/entities/user.entity';
import { authCookie, readAuthCookie, signTestToken, testCacheModule } from './helpers/auth';
import { MemoryRedis } from './helpers/memory-redis';
import {
  clearSQLiteTables,
  getSQLiteEntities,
  getTestSQLiteConfig,
} from './helpers/test-database.helper';

jest.setTimeout(120_000);

const redis = new MemoryRedis();
const storageRoot = mkdtempSync(join(tmpdir(), 'platform-e2e-'));

@Global()
@Module({
  providers: [
    { provide: APP_REDIS, useValue: redis },
    { provide: ATTACHMENT_STORAGE_ROOT, useValue: storageRoot },
  ],
  exports: [APP_REDIS, ATTACHMENT_STORAGE_ROOT],
})
class TestInfraModule {}

const CONSOLE_PASSWORD = 'console-password-0123456789abcdef';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

/**
 * The platform console, profile self-service and the locked-down company
 * routes, end to end on in-memory SQLite with the real global guards: unlock
 * -> create a company with its first admin -> sign in as that admin -> delete
 * -> restore. Responses go through `ZodSerializerInterceptor`, so a payload
 * that breaks its contract fails the request.
 */
describe('Platform console (e2e, sqlite)', () => {
  let app: INestApplication;
  let server: App;
  let dataSource: DataSource;
  let seq = 0;
  const originalPassword = process.env.PLATFORM_CONSOLE_PASSWORD;

  beforeAll(async () => {
    process.env.PLATFORM_CONSOLE_PASSWORD = CONSOLE_PASSWORD;

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
        TestInfraModule,
        AuthModule,
        CompanyModule,
        PlatformModule,
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
    rmSync(storageRoot, { recursive: true, force: true });
    if (originalPassword === undefined) delete process.env.PLATFORM_CONSOLE_PASSWORD;
    else process.env.PLATFORM_CONSOLE_PASSWORD = originalPassword;
  });

  beforeEach(async () => {
    await clearSQLiteTables(dataSource);
    redis.store.clear();
    redis.failing = false;
    process.env.PLATFORM_CONSOLE_PASSWORD = CONSOLE_PASSWORD;
  });

  // ---------------------------------------------------------------------------
  // Seeding helpers
  // ---------------------------------------------------------------------------

  const save = <T extends object>(entity: new () => T, data: Partial<T>) => {
    const repo = dataSource.getRepository(entity);
    return repo.save(repo.create(data as T));
  };

  /** A user, optionally a platform admin, who is a member of a fresh company. */
  const createSession = async (
    options: { platformAdmin?: boolean; role?: MemberRole; company?: Company; password?: string } = {},
  ) => {
    const company = options.company ?? (await save(Company, { name: `company-${++seq}` }));
    const user = await save(User, {
      username: `user-${++seq}`,
      passwordHash: await bcrypt.hash(options.password ?? 'user-password-1', 4),
      isPlatformAdmin: options.platformAdmin ?? false,
    });
    const role = options.role ?? 'admin';
    const member = await save(CompanyMember, {
      userId: user.id,
      companyId: company.id,
      role,
      status: 'active',
    });
    // Issued a moment ago, so a later revocation marks it stale.
    const token = signTestToken({
      sub: user.id,
      memberships: [{ cid: company.id, mid: member.id, role }],
      ts: Date.now() - 5_000,
    });

    return { user, member, company, token, cookie: authCookie(token) };
  };

  type Session = Awaited<ReturnType<typeof createSession>>;

  const body = <T>(res: request.Response): T => res.body as T;

  const platformCookieOf = (res: request.Response): string => {
    const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = header.find((c) => c.startsWith('platform_token='));
    if (!cookie) throw new Error('no platform_token cookie in the response');

    return cookie.split(';')[0];
  };

  const unlock = (session: Session, password = CONSOLE_PASSWORD) =>
    request(server).post('/platform/unlock').set('Cookie', session.cookie).send({ password });

  /** Session + the unlocked-console cookie. */
  const unlocked = async (session: Session) => {
    const res = await unlock(session).expect(200);
    return `${session.cookie}; ${platformCookieOf(res)}`;
  };

  const as = (cookie: string) => ({
    post: (url: string, payload?: object) => request(server).post(url).set('Cookie', cookie).send(payload),
    patch: (url: string, payload: object) => request(server).patch(url).set('Cookie', cookie).send(payload),
    delete: (url: string) => request(server).delete(url).set('Cookie', cookie),
    get: (url: string) => request(server).get(url).set('Cookie', cookie),
  });

  const table = (cookie: string, includeDeleted = false) =>
    as(cookie)
      .post('/platform/companies/table', { includeDeleted, sort: [{ id: 'name', desc: false }] })
      .expect(200);

  // ---------------------------------------------------------------------------
  // Console switch
  // ---------------------------------------------------------------------------

  describe('console switched off', () => {
    it.each(['disabled', ''])(
      'answers status 200 with enabled:false and 404 on every other /platform route (%p)',
      async (value) => {
        process.env.PLATFORM_CONSOLE_PASSWORD = value;
        const admin = await createSession({ platformAdmin: true });
        const cookie = `${admin.cookie}; platform_token=whatever`;

        const status = body<PlatformStatus>(
          await as(admin.cookie).get('/platform/status').expect(200),
        );
        expect(status).toEqual({ enabled: false, unlocked: false });

        await unlock(admin).expect(404);
        await as(cookie).post('/platform/lock').expect(404);
        await as(cookie).post('/platform/companies/table', {}).expect(404);
        await as(cookie).post('/platform/companies', { name: 'X' }).expect(404);
        await as(cookie).patch('/platform/companies/abc', { name: 'X' }).expect(404);
        await as(cookie).delete('/platform/companies/abc').expect(404);
        await as(cookie).post('/platform/companies/abc/restore').expect(404);
      },
    );
  });

  describe('unlock', () => {
    it('needs a session', async () => {
      await request(server).get('/platform/status').expect(401);
      await request(server).post('/platform/unlock').send({ password: CONSOLE_PASSWORD }).expect(401);
    });

    it('reports a locked console and refuses company routes until unlocked', async () => {
      const admin = await createSession({ platformAdmin: true });

      expect(
        body<PlatformStatus>(await as(admin.cookie).get('/platform/status').expect(200)),
      ).toMatchObject({ enabled: true, unlocked: false });
      const res = await as(admin.cookie).post('/platform/companies/table', {}).expect(403);
      expect(res.body).toMatchObject({ code: 'platform_locked' });
    });

    it('refuses a wrong password and a user who is not a platform admin', async () => {
      const admin = await createSession({ platformAdmin: true });
      const plain = await createSession();

      const wrong = await unlock(admin, 'nope').expect(403);
      expect(wrong.body).toMatchObject({ code: 'platform_invalid_password' });
      expect(wrong.headers['set-cookie']).toBeUndefined();

      const forbidden = await unlock(plain).expect(403);
      expect(forbidden.body).toMatchObject({ code: 'platform_forbidden' });
      expect(forbidden.headers['set-cookie']).toBeUndefined();
    });

    it('rate limits to 5 failed attempts per user, answering 429 with retryAfterSec', async () => {
      const admin = await createSession({ platformAdmin: true });
      const other = await createSession({ platformAdmin: true });

      for (let attempt = 0; attempt < 5; attempt++) await unlock(admin, 'nope').expect(403);
      const blocked = await unlock(admin).expect(429);

      expect(blocked.body).toMatchObject({ enabled: true, unlocked: false });
      expect((blocked.body as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
      await unlock(other).expect(200);
    });

    it('sets an httpOnly SameSite=Strict 30 minute cookie and opens the routes', async () => {
      const admin = await createSession({ platformAdmin: true });

      const res = await unlock(admin).expect(200);

      const raw = ([] as string[]).concat(res.headers['set-cookie']).find((c) =>
        c.startsWith('platform_token='),
      )!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Strict/i);
      expect(raw).toMatch(/Path=\//);
      expect(raw).toMatch(/Max-Age=1800/);
      expect(body<PlatformStatus>(res)).toMatchObject({ enabled: true, unlocked: true });

      const cookie = `${admin.cookie}; ${platformCookieOf(res)}`;
      expect(
        body<PlatformStatus>(await as(cookie).get('/platform/status').expect(200)),
      ).toMatchObject({ unlocked: true });
      await table(cookie);
    });

    it('locks again on request', async () => {
      const admin = await createSession({ platformAdmin: true });
      const cookie = await unlocked(admin);

      const res = await as(cookie).post('/platform/lock').expect(200);
      expect(body<PlatformStatus>(res)).toMatchObject({ unlocked: false });
      expect(([] as string[]).concat(res.headers['set-cookie']).join(';')).toMatch(
        /platform_token=;/,
      );
    });
  });

  describe('token isolation', () => {
    it('does not accept an access token as a platform token', async () => {
      const admin = await createSession({ platformAdmin: true });

      const cookie = `${admin.cookie}; platform_token=${admin.token}`;

      await as(cookie).post('/platform/companies/table', {}).expect(403);
    });

    it('does not accept a platform token as a session', async () => {
      const admin = await createSession({ platformAdmin: true });
      const platformCookie = platformCookieOf(await unlock(admin).expect(200));

      await request(server)
        .get('/users/me')
        .set('Cookie', `access_token=${platformCookie.split('=')[1]}`)
        .expect(401);
    });

    it('rejects the platform token of another user', async () => {
      const first = await createSession({ platformAdmin: true });
      const second = await createSession({ platformAdmin: true });
      const firstToken = platformCookieOf(await unlock(first).expect(200));

      await as(`${second.cookie}; ${firstToken}`)
        .post('/platform/companies/table', {})
        .expect(403);
    });

    it('locks the moment the user stops being a platform admin', async () => {
      const admin = await createSession({ platformAdmin: true });
      const cookie = await unlocked(admin);
      await table(cookie);

      await dataSource.getRepository(User).update(admin.user.id, { isPlatformAdmin: false });

      await as(cookie).post('/platform/companies/table', {}).expect(403);
    });

    it('needs no company header and ignores the company role', async () => {
      const agent = await createSession({ platformAdmin: true, role: 'agent' });
      const cookie = await unlocked(agent);

      await table(cookie);
    });
  });

  // ---------------------------------------------------------------------------
  // Companies lifecycle
  // ---------------------------------------------------------------------------

  describe('companies', () => {
    it('creates a company with its first admin, who can then sign in', async () => {
      const root = await createSession({ platformAdmin: true });
      const cookie = await unlocked(root);

      const created = body<PlatformCreateCompanyResult>(
        await as(cookie)
          .post('/platform/companies', {
            name: 'Acme',
            email: 'hello@acme.test',
            admin: { email: 'boss@acme.test', firstName: 'Bea' },
          })
          .expect(201),
      );

      expect(created.adminOutcome).toBe('created');
      expect(created.initialPassword).toEqual(expect.any(String));
      expect(created.company).toMatchObject({ name: 'Acme', status: 'active', membersCount: 1 });

      const boss = await dataSource.getRepository(User).findOneByOrFail({ email: 'boss@acme.test' });
      const login = await request(server)
        .post('/auth/login')
        .send({ username: boss.username, password: created.initialPassword })
        .expect(200);
      const session = readAuthCookie(login.headers['set-cookie'])!;

      const profile = body<CompanyProfile>(
        await request(server)
          .get('/company/me')
          .set('Cookie', authCookie(session))
          .set('x-company-id', created.company.id)
          .expect(200),
      );
      expect(profile).toMatchObject({ id: created.company.id, name: 'Acme' });
    });

    it('creates a company without an admin and links an existing account without a password', async () => {
      const root = await createSession({ platformAdmin: true });
      const cookie = await unlocked(root);
      const existing = await createSession({ password: 'keep-this-1' });
      const email = 'linked@acme.test';
      await dataSource.getRepository(User).update(existing.user.id, { email });

      const bare = body<PlatformCreateCompanyResult>(
        await as(cookie).post('/platform/companies', { name: 'Bare' }).expect(201),
      );
      expect(bare).toMatchObject({ adminOutcome: null });
      expect(bare.initialPassword).toBeUndefined();

      const linked = body<PlatformCreateCompanyResult>(
        await as(cookie)
          .post('/platform/companies', { name: 'Linked', admin: { email } })
          .expect(201),
      );
      expect(linked.adminOutcome).toBe('linked');
      expect(linked.initialPassword).toBeUndefined();
      await request(server)
        .post('/auth/login')
        .send({ username: existing.user.username, password: 'keep-this-1' })
        .expect(200);
    });

    it('answers 409 for a duplicated company email and 400 for an invalid body', async () => {
      const cookie = await unlocked(await createSession({ platformAdmin: true }));
      await as(cookie).post('/platform/companies', { name: 'A', email: 'dup@acme.test' }).expect(201);

      await as(cookie).post('/platform/companies', { name: 'B', email: 'dup@acme.test' }).expect(409);
      await as(cookie).post('/platform/companies', { name: ' ' }).expect(400);
      await as(cookie).post('/platform/companies', { name: 'C', admin: { email: 'nope' } }).expect(400);
    });

    it('runs the whole lifecycle: create -> suspend -> delete -> restore, revoking member sessions', async () => {
      const root = await createSession({ platformAdmin: true });
      const cookie = await unlocked(root);
      const created = body<PlatformCreateCompanyResult>(
        await as(cookie)
          .post('/platform/companies', { name: 'Acme', admin: { email: 'boss@acme.test' } })
          .expect(201),
      );
      const companyId = created.company.id;

      // A live session of the new admin, issued after the creation revoked the
      // old ones and before the changes below.
      const boss = await dataSource.getRepository(User).findOneByOrFail({ email: 'boss@acme.test' });
      const bossMember = await dataSource
        .getRepository(CompanyMember)
        .findOneByOrFail({ userId: boss.id });
      const bossCookie = authCookie(
        signTestToken({
          sub: boss.id,
          memberships: [{ cid: companyId, mid: bossMember.id, role: 'admin' }],
          ts: Date.now(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      const bossGet = () =>
        request(server).get('/company/me').set('Cookie', bossCookie).set('x-company-id', companyId);
      await bossGet().expect(200);

      // Suspend: members are told to refresh their memberships.
      const suspended = await as(cookie)
        .patch(`/platform/companies/${companyId}`, { status: 'suspended', name: 'Acme Suspended' })
        .expect(200);
      expect(suspended.body).toMatchObject({ status: 'suspended', name: 'Acme Suspended' });
      expect((await bossGet().expect(401)).body).toMatchObject({ code: 'token_stale' });

      // Delete: soft, with the number of members that lost access.
      const removed = body<PlatformDeleteCompanyResult>(
        await as(cookie).delete(`/platform/companies/${companyId}`).expect(200),
      );
      expect(removed).toEqual({ affectedMembers: 1 });

      const listed = body<PlatformCompanyTableResponse>(await table(cookie));
      expect(listed.items.map((c) => c.id)).not.toContain(companyId);
      const withDeleted = body<PlatformCompanyTableResponse>(await table(cookie, true));
      expect(withDeleted.items.find((c) => c.id === companyId)).toMatchObject({
        deletedAt: expect.any(String) as string,
        membersCount: 1,
      });
      await as(cookie).patch(`/platform/companies/${companyId}`, { name: 'X' }).expect(404);
      await as(cookie).delete(`/platform/companies/${companyId}`).expect(404);

      // Restore: back in the default table, with the same members.
      const restored = await as(cookie).post(`/platform/companies/${companyId}/restore`).expect(200);
      expect(restored.body).toMatchObject({ id: companyId, deletedAt: null, membersCount: 1 });
      expect(
        body<PlatformCompanyTableResponse>(await table(cookie)).items.map((c) => c.id),
      ).toContain(companyId);
    });

    it('answers 404 for unknown companies', async () => {
      const cookie = await unlocked(await createSession({ platformAdmin: true }));

      await as(cookie).patch('/platform/companies/unknown', { name: 'X' }).expect(404);
      await as(cookie).delete('/platform/companies/unknown').expect(404);
      await as(cookie).post('/platform/companies/unknown/restore').expect(404);
    });

    it('reports counts in the table', async () => {
      const root = await createSession({ platformAdmin: true });
      const cookie = await unlocked(root);

      const { items } = body<PlatformCompanyTableResponse>(await table(cookie));

      // The seeded company of the platform admin is the only one: one member.
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ membersCount: 1, customersCount: 0, channelsCount: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // Lock-down of /company and /users
  // ---------------------------------------------------------------------------

  describe('company routes', () => {
    it('no longer exposes create, list, read-by-id or delete', async () => {
      const admin = await createSession();
      const withCompany = (req: request.Test) =>
        req.set('Cookie', admin.cookie).set('x-company-id', admin.company.id);

      await withCompany(request(server).post('/company').send({ name: 'Rogue' })).expect(404);
      await withCompany(request(server).get('/company')).expect(404);
      await withCompany(request(server).get(`/company/${admin.company.id}`)).expect(404);
      await withCompany(request(server).delete(`/company/${admin.company.id}`)).expect(404);
      expect(await dataSource.getRepository(Company).countBy({ name: 'Rogue' })).toBe(0);
    });

    it('lets only an admin edit the company data', async () => {
      const admin = await createSession({ role: 'admin' });
      const supervisor = await createSession({ role: 'supervisor', company: admin.company });
      const patch = (s: Session, payload: object) =>
        request(server)
          .patch('/company/me')
          .set('Cookie', s.cookie)
          .set('x-company-id', s.company.id)
          .send(payload);

      await patch(supervisor, { name: 'Hijacked' }).expect(403);
      const res = await patch(admin, { name: 'Renamed', timezone: 'America/Bogota' }).expect(200);

      expect(body<CompanyProfile>(res)).toMatchObject({ name: 'Renamed', timezone: 'America/Bogota' });
    });

    it('lets supervisors but not agents change the assignment settings', async () => {
      const supervisor = await createSession({ role: 'supervisor' });
      const agent = await createSession({ role: 'agent', company: supervisor.company });
      const patch = (s: Session) =>
        request(server)
          .patch('/company/me/assignment-settings')
          .set('Cookie', s.cookie)
          .set('x-company-id', s.company.id)
          .send({ autoAssignMaxOpen: 3 });

      await patch(agent).expect(403);
      expect((await patch(supervisor).expect(200)).body).toEqual({
        autoAssignEnabled: true,
        autoAssignMaxOpen: 3,
        autoAssignSticky: true,
        autoAssignNotifySupervisors: true,
      });
    });
  });

  describe('users self-service', () => {
    it('no longer exposes the user CRUD', async () => {
      const admin = await createSession();
      const withCompany = (req: request.Test) =>
        req.set('Cookie', admin.cookie).set('x-company-id', admin.company.id);

      await withCompany(request(server).get('/users')).expect(404);
      await withCompany(request(server).get('/users/search?q=a')).expect(404);
      await withCompany(request(server).get(`/users/${admin.user.username}`)).expect(404);
      await withCompany(request(server).post('/users').send({ username: 'x', password: 'xxxxxxxx' })).expect(404);
      await withCompany(request(server).post('/users/table').send({})).expect(404);
      await withCompany(request(server).post('/users/import')).expect(404);
      await withCompany(request(server).patch(`/users/${admin.user.id}`).send({})).expect(404);
      await withCompany(request(server).delete(`/users/${admin.user.id}`)).expect(404);
      await withCompany(request(server).get('/users/me')).expect(200);
    });

    it('edits the own profile but not another account contact data', async () => {
      const first = await createSession();
      const second = await createSession();
      await dataSource.getRepository(User).update(second.user.id, { email: 'taken@acme.test' });

      const res = await as(first.cookie)
        .patch('/users/me', { firstName: 'Ana', email: 'Ana@Acme.test', username: 'hacked', isPlatformAdmin: true })
        .expect(200);

      expect(body<AuthUser>(res)).toMatchObject({
        firstName: 'Ana',
        email: 'ana@acme.test',
        username: first.user.username,
        isPlatformAdmin: false,
      });
      await as(first.cookie).patch('/users/me', { email: 'taken@acme.test' }).expect(409);
    });

    it('changes the password: other sessions close, the caller keeps working', async () => {
      const user = await createSession({ password: 'old-password-1' });
      const login = await request(server)
        .post('/auth/login')
        .send({ username: user.user.username, password: 'old-password-1' })
        .expect(200);
      const loginToken = readAuthCookie(login.headers['set-cookie'])!;
      // Make sure the marker written by the change is later than the login token.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await as(authCookie(loginToken))
        .post('/users/me/password', { currentPassword: 'wrong', newPassword: 'new-password-2' })
        .expect(400);
      const changed = await as(authCookie(loginToken))
        .post('/users/me/password', { currentPassword: 'old-password-1', newPassword: 'new-password-2' })
        .expect(200);

      // The cookie re-issued with the response still works...
      const fresh = readAuthCookie(changed.headers['set-cookie'])!;
      await as(authCookie(fresh)).get('/users/me').expect(200);
      // ...every other session is stale, including the one that made the call.
      expect((await as(user.cookie).get('/users/me').expect(401)).body).toMatchObject({
        code: 'token_stale',
      });
      expect((await as(authCookie(loginToken)).get('/users/me').expect(401)).body).toMatchObject({
        code: 'token_stale',
      });

      await request(server)
        .post('/auth/login')
        .send({ username: user.user.username, password: 'old-password-1' })
        .expect(401);
      await request(server)
        .post('/auth/login')
        .send({ username: user.user.username, password: 'new-password-2' })
        .expect(200);
    });

    it('signs out everywhere on request', async () => {
      const user = await createSession();

      const res = await as(user.cookie).post('/auth/revoke-all').expect(200);

      expect(([] as string[]).concat(res.headers['set-cookie']).join(';')).toMatch(/access_token=;/);
      expect((await as(user.cookie).get('/users/me').expect(401)).body).toMatchObject({
        code: 'token_stale',
      });
    });

    it('stores an avatar sniffed from its bytes and serves it back', async () => {
      const user = await createSession();
      const other = await createSession();

      const html = await request(server)
        .post('/users/me/avatar')
        .set('Cookie', user.cookie)
        .attach('file', Buffer.from('<html></html>'), { filename: 'a.png', contentType: 'image/png' });
      expect(html.status).toBe(415);

      const big = await request(server)
        .post('/users/me/avatar')
        .set('Cookie', user.cookie)
        .attach('file', Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        });
      expect(big.status).toBe(413);

      await as(user.cookie).get(`/users/${user.user.id}/avatar`).expect(404);

      const uploaded = await request(server)
        .post('/users/me/avatar')
        .set('Cookie', user.cookie)
        .attach('file', JPEG, { filename: 'a.bin', contentType: 'application/octet-stream' })
        .expect(200);
      const { avatarUrl } = body<{ avatarUrl: string }>(uploaded);
      expect(avatarUrl).toMatch(new RegExp(`^/users/${user.user.id}/avatar\\?v=\\d+$`));
      expect(readdirSync(join(storageRoot, 'avatars'))).toEqual([`${user.user.id}.jpg`]);

      // Any signed-in user can load it, with a private day-long cache.
      const served = await as(other.cookie).get(avatarUrl).buffer(true).expect(200);
      expect(served.headers['content-type']).toBe('image/jpeg');
      expect(served.headers['cache-control']).toBe('private, max-age=86400');
      expect(Buffer.compare(served.body as Buffer, JPEG)).toBe(0);
      await request(server).get(avatarUrl).expect(401);

      const profile = body<AuthUser>(await as(user.cookie).get('/users/me').expect(200));
      expect(profile.avatarUrl).toBe(avatarUrl);
    });
  });
});
