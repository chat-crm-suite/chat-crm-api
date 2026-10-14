// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { ClsModule } from 'nestjs-cls';
import { I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, EntityTarget } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import type { JwtPayload } from '@auth/auth.types';
import { SessionRevocationService } from '@auth/session/session-revocation.service';
import { clsConfig } from '@config/cls.config';
import { i18nConfig } from '@config/i18n.config';
import { loggerConfig } from '@config/logger.config';
import type { MemberRole } from '@contracts';
import * as Entities from '@entities';
import { AttachmentSignatureService } from '@modules/attachments/attachment-signature.service';
import {
  ATTACHMENT_STORAGE_ROOT,
  AttachmentStorageService,
} from '@modules/media/attachment-storage.service';
import { AttachmentsController } from '@modules/attachments/attachments.controller';
import { AttachmentsService } from '@modules/attachments/attachments.service';
import { Channel } from '@modules/channels/entities/channel.entity';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { Company } from '@modules/company/entities/company.entity';
import { ConversationAssignmentService } from '@modules/conversations/assignment/conversation-assignment.service';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { ConversationAccessService } from '@modules/conversations/realtime/conversation-access.service';
import { Customer } from '@modules/customers/entities/customer.entity';
import { MessageAttachment } from '@modules/message/entities/message-attachment.entity';
import { Message } from '@modules/message/entities/message.entity';
import { MessageModule } from '@modules/message/message.module';
import { User } from '@modules/users/entities/user.entity';
import { authCookie, readAuthCookie, signTestToken, testCacheModule } from './helpers/auth';
import { getTestConfig, truncateAllTables } from './helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];
const PASSWORD = 'secreta-123';

jest.setTimeout(180_000);

/**
 * Tenant context end to end: the token carries the memberships, the client
 * picks the company per request with `x-company-id`, and the server honors it
 * only for a company in the token. Attachments work from a plain `<img>`
 * (cookie only). Revoking a user marks the token stale until it is refreshed.
 */
describe('Tenant context (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let dataSource: DataSource;
  let storageRoot: string;
  let seq = 0;

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'tenant-e2e-'));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        LoggerModule.forRoot(loggerConfig),
        ClsModule.forRoot(clsConfig),
        I18nModule.forRoot({
          ...i18nConfig,
          loaderOptions: {
            path: join(__dirname, '../src/locales/'),
            watch: false,
          },
        }),
        TypeOrmModule.forRoot(getTestConfig(entities)),
        testCacheModule(),
        AuthModule,
        MessageModule,
      ],
      // The real attachments controller and access seam, without the queue and
      // gateway wiring of `ConversationsModule`.
      controllers: [AttachmentsController],
      providers: [
        AttachmentsService,
        AttachmentStorageService,
        AttachmentSignatureService,
        ConversationAccessService,
        ConversationAssignmentService,
        { provide: ATTACHMENT_STORAGE_ROOT, useValue: storageRoot },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(false);
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();

    server = app.getHttpServer() as App;
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  const createCompany = () => {
    const repo = dataSource.getRepository(Company);
    return repo.save(repo.create({ name: `company-${++seq}` }));
  };

  const createUser = async () => {
    const repo = dataSource.getRepository(User);
    return repo.save(
      repo.create({
        username: `user-${++seq}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      }),
    );
  };

  const addMember = (user: User, company: Company, role: MemberRole) => {
    const repo = dataSource.getRepository(CompanyMember);
    return repo.save(
      repo.create({ userId: user.id, companyId: company.id, role, status: 'active' }),
    );
  };

  const login = async (user: User) => {
    const res = await request(server)
      .post('/auth/login')
      .send({ username: user.username, password: PASSWORD })
      .expect(200);

    const token = readAuthCookie(res.headers['set-cookie']);
    if (!token) throw new Error('login did not set the session cookie');
    return token;
  };

  const claimsOf = (token: string) =>
    new JwtService({}).decode<JwtPayload>(token);

  const seedAttachment = async (company: Company) => {
    const customers = dataSource.getRepository(Customer);
    const customer = await customers.save(
      customers.create({
        companyId: company.id,
        displayName: `Customer ${++seq}`,
        phoneNumber: `+54911${String(++seq).padStart(8, '0')}`,
      }),
    );
    const channels = dataSource.getRepository(Channel);
    const channel = await channels.save(
      channels.create({
        companyId: company.id,
        type: 'whatsapp',
        name: `channel-${++seq}`,
        externalAccountId: `wa-account-${++seq}`,
        credentials: 'test-credentials',
      }),
    );
    const conversations = dataSource.getRepository(Conversation);
    const conversation = await conversations.save(
      conversations.create({
        companyId: company.id,
        customerId: customer.id,
        channelId: channel.id,
      }),
    );
    const messages = dataSource.getRepository(Message);
    const message = await messages.save(
      messages.create({
        companyId: company.id,
        conversationId: conversation.id,
        direction: 'inbound',
        senderType: 'customer',
        senderCustomerId: customer.id,
        type: 'image',
        status: 'delivered',
      }),
    );

    const fileName = `photo-${++seq}.jpg`;
    mkdirSync(join(storageRoot, company.id), { recursive: true });
    writeFileSync(join(storageRoot, company.id, fileName), 'jpeg-bytes');

    const attachments = dataSource.getRepository(MessageAttachment);
    return attachments.save(
      attachments.create({
        messageId: message.id,
        type: 'image',
        mimeType: 'image/jpeg',
        status: 'ready',
        storageUrl: `/uploads/${company.id}/${fileName}`,
        sizeBytes: 10,
      }),
    );
  };

  describe('login', () => {
    it('embeds every active membership in the session token', async () => {
      const user = await createUser();
      const x = await createCompany();
      const y = await createCompany();
      const admin = await addMember(user, x, 'admin');
      const agent = await addMember(user, y, 'agent');

      const claims = claimsOf(await login(user));

      expect(claims?.sub).toBe(user.id);
      expect(claims?.memberships).toEqual(
        expect.arrayContaining([
          { cid: x.id, mid: admin.id, role: 'admin' },
          { cid: y.id, mid: agent.id, role: 'agent' },
        ]),
      );
    });

    it('lists the companies in /auth/me without any company header', async () => {
      const user = await createUser();
      const x = await createCompany();
      await addMember(user, x, 'admin');
      const token = await login(user);

      const res = await request(server)
        .get('/auth/me')
        .set('Cookie', authCookie(token))
        .expect(200);

      expect((res.body as { user: { memberships: unknown[] } }).user.memberships).toEqual([
        expect.objectContaining({ companyId: x.id, role: 'admin', status: 'active' }),
      ]);
    });
  });

  describe('company context per request', () => {
    it('serves each of the user companies by switching only the header', async () => {
      const user = await createUser();
      const x = await createCompany();
      const y = await createCompany();
      await addMember(user, x, 'admin');
      await addMember(user, y, 'agent');
      const cookie = authCookie(await login(user));

      for (const [company, role] of [[x, 'admin'], [y, 'agent']] as const) {
        const res = await request(server)
          .get('/company-members/current')
          .set('Cookie', cookie)
          .set('x-company-id', company.id)
          .expect(200);

        expect(res.body).toEqual(
          expect.objectContaining({ companyId: company.id, role }),
        );
      }
    });

    it('answers 403 for a company the user does not belong to', async () => {
      const user = await createUser();
      await addMember(user, await createCompany(), 'admin');
      const foreign = await createCompany();
      const cookie = authCookie(await login(user));

      await request(server)
        .get('/company-members/current')
        .set('Cookie', cookie)
        .set('x-company-id', foreign.id)
        .expect(403);
    });

    it('answers 400 for a tenant route without a company header', async () => {
      const user = await createUser();
      await addMember(user, await createCompany(), 'admin');
      const cookie = authCookie(await login(user));

      await request(server)
        .get('/company-members/current')
        .set('Cookie', cookie)
        .expect(400);
    });

    it('answers 401 without a session', async () => {
      const company = await createCompany();

      await request(server)
        .get('/company-members/current')
        .set('x-company-id', company.id)
        .expect(401);
    });
  });

  describe('attachments', () => {
    it('streams an attachment of one of the user companies with the cookie only', async () => {
      const user = await createUser();
      const company = await createCompany();
      await addMember(user, company, 'admin');
      const attachment = await seedAttachment(company);
      const cookie = authCookie(await login(user));

      // Exactly what an <img src="/attachments/:id"> sends: no company header.
      const res = await request(server)
        .get(`/attachments/${attachment.id}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, max-age=0, no-store');
    });

    it('denies an attachment of a company the user does not belong to', async () => {
      const user = await createUser();
      await addMember(user, await createCompany(), 'admin');
      const attachment = await seedAttachment(await createCompany());
      const cookie = authCookie(await login(user));

      await request(server)
        .get(`/attachments/${attachment.id}`)
        .set('Cookie', cookie)
        .expect(403);
    });

    it('denies a leaked attachment URL without a session', async () => {
      const attachment = await seedAttachment(await createCompany());

      await request(server).get(`/attachments/${attachment.id}`).expect(401);
    });
  });

  describe('revocation and refresh', () => {
    it('marks the token stale on revoke and refreshes it without a password', async () => {
      const user = await createUser();
      const x = await createCompany();
      const y = await createCompany();
      await addMember(user, x, 'admin');
      const removed = await addMember(user, y, 'agent');
      const staleToken = await login(user);

      // An admin removes the user from Y.
      await dataSource
        .getRepository(CompanyMember)
        .update({ id: removed.id }, { status: 'inactive' });
      await app.get(SessionRevocationService).revoke(user.id);

      const stale = await request(server)
        .get('/company-members/current')
        .set('Cookie', authCookie(staleToken))
        .set('x-company-id', x.id)
        .expect(401);
      expect(stale.body).toEqual(expect.objectContaining({ code: 'token_stale' }));

      const refreshed = await request(server)
        .post('/auth/refresh-memberships')
        .set('Cookie', authCookie(staleToken))
        .expect(200);
      const freshToken = readAuthCookie(refreshed.headers['set-cookie']);
      expect(freshToken).toBeTruthy();
      expect(claimsOf(freshToken as string)?.memberships).toEqual([
        expect.objectContaining({ cid: x.id }),
      ]);

      await request(server)
        .get('/company-members/current')
        .set('Cookie', authCookie(freshToken as string))
        .set('x-company-id', x.id)
        .expect(200);
      await request(server)
        .get('/company-members/current')
        .set('Cookie', authCookie(freshToken as string))
        .set('x-company-id', y.id)
        .expect(403);
    });

    it('asks a token issued before the tenant claims to refresh', async () => {
      const user = await createUser();
      const company = await createCompany();
      await addMember(user, company, 'admin');
      const legacy = signTestToken({
        sub: user.id,
        company: 'no implemented yet',
        memberships: undefined,
        ts: undefined,
      });

      const res = await request(server)
        .get('/company-members/current')
        .set('Cookie', authCookie(legacy))
        .set('x-company-id', company.id)
        .expect(401);
      expect(res.body).toEqual(expect.objectContaining({ code: 'token_stale' }));

      const refreshed = await request(server)
        .post('/auth/refresh-memberships')
        .set('Cookie', authCookie(legacy))
        .expect(200);
      expect(
        claimsOf(readAuthCookie(refreshed.headers['set-cookie']) as string)?.memberships,
      ).toEqual([expect.objectContaining({ cid: company.id, role: 'admin' })]);
    });

    it('refuses to refresh a forged token', async () => {
      const forged = new JwtService({ secret: 'not-the-secret' }).sign({ sub: 'user-x' });

      await request(server)
        .post('/auth/refresh-memberships')
        .set('Cookie', authCookie(forged))
        .expect(401);
    });
  });
});
