// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { ClsModule } from 'nestjs-cls';
import { I18nModule, I18nService } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import { APP_REDIS } from '@common/redis/app-redis.module';
import { MemoryRedis } from './helpers/memory-redis';
import { testCacheModule } from './helpers/auth';
import { ZodValidationExceptionFilter } from '@common/filters/zod-validation.filter';
import { loggerConfig } from '@config/logger.config';
import { i18nConfig } from '@config/i18n.config';
import { clsConfig } from '@config/cls.config';
import { ChannelsModule } from '@modules/channels/channels.module';
import { Channel } from '@modules/channels/entities/channel.entity';
import { MetaCredentialsProbe } from '@modules/setup/meta-credentials.probe';
import { SetupModule } from '@modules/setup/setup.module';
import {
  getSQLiteEntities,
  getTestSQLiteConfig,
} from './helpers/test-database.helper';

// Redis stub: presence/session services need APP_REDIS, nothing here reads it.
@Global()
@Module({
  providers: [{ provide: APP_REDIS, useValue: new MemoryRedis() }],
  exports: [APP_REDIS],
})
class TestInfraModule {}

interface SetupStatusBody {
  initialized: boolean;
  hasAdmin: boolean;
  hasCompany: boolean;
  hasWhatsapp: boolean;
  hasUsers: boolean;
  requiresSetupToken: boolean;
}

interface SetupResultBody {
  user: { id: string; username: string };
  company: { id: string; name: string };
  channel: { id: string; webhookVerifyToken: string | null } | null;
}

jest.setTimeout(180_000);

// Flujo de primer arranque sobre SQLite en memoria (sin MySQL ni Redis).
// Cubre el contrato de `setup` y que la sesión creada sirve para autenticar.
// Meta is never called from tests: the probe answers like a valid number.
const metaProbe = {
  probe: jest.fn().mockResolvedValue({
    kind: 'ok',
    displayPhoneNumber: '+51 999 999 999',
    verifiedName: 'J&P',
  }),
};

const createApp = async (setupToken?: string): Promise<INestApplication> => {
  // Channel credentials are encrypted: a fixed test key, never the machine's .env.
  process.env.CREDENTIALS_ENCRYPTION_KEY = '0'.repeat(64);
  if (setupToken === undefined) {
    delete process.env.SETUP_TOKEN;
  } else {
    process.env.SETUP_TOKEN = setupToken;
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      LoggerModule.forRoot(loggerConfig),
      ClsModule.forRoot(clsConfig),
      // Real i18n module (locales resolved from src/, unlike the app build).
      I18nModule.forRoot({
        ...i18nConfig,
        loaderOptions: {
          path: join(__dirname, '../src/locales/'),
          watch: false,
        },
      }),
      TypeOrmModule.forRoot(getTestSQLiteConfig(getSQLiteEntities())),
      testCacheModule(),
      TestInfraModule,
      SetupModule,
      ChannelsModule,
      AuthModule,
    ],
  })
    .overrideProvider(MetaCredentialsProbe)
    .useValue(metaProbe)
    .compile();

  // El bootstrap por env no debe contaminar una BD "recién instalada".
  process.env.BOOTSTRAP_ADMIN_USERNAME = '';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
  process.env.BOOTSTRAP_COMPANY_NAME = '';

  const app = moduleFixture.createNestApplication();
  // E2E_DEBUG=1 keeps the Nest logger on to see the exception behind a 500.
  if (!process.env.E2E_DEBUG) app.useLogger(false);
  app.use(cookieParser());
  // Same validation pipeline the HTTP bootstrap registers for Zod DTOs.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(
    new ZodValidationExceptionFilter(app.get(I18nService)),
  );
  await app.init();

  return app;
};

const validSetup = {
  admin: { username: 'admin', password: 'secreta-123' },
  company: { name: 'J&P Perifericos' },
};

describe('Setup first-run flow (e2e)', () => {
  describe('fresh workspace without whatsapp', () => {
    let app: INestApplication;
    let server: App;
    let companyId: string;

    beforeAll(async () => {
      app = await createApp();
      server = app.getHttpServer() as App;
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports a fresh database as not initialized', async () => {
      const res = await request(server).get('/setup/status').expect(200);
      const body = res.body as SetupStatusBody;

      expect(body).toEqual({
        initialized: false,
        hasAdmin: false,
        hasCompany: false,
        hasWhatsapp: false,
        hasUsers: false,
        requiresSetupToken: false,
      });
    });

    it('creates admin, company and membership in a single call', async () => {
      const res = await request(server)
        .post('/setup')
        .send(validSetup)
        .expect(201);
      const body = res.body as SetupResultBody;

      expect(body.company.name).toBe('J&P Perifericos');
      expect(body.channel).toBeNull();
      companyId = body.company.id;
    });

    it('reports the workspace as initialized and without whatsapp', async () => {
      const res = await request(server).get('/setup/status').expect(200);
      const body = res.body as SetupStatusBody;

      expect(body).toEqual({
        initialized: true,
        hasAdmin: true,
        hasCompany: true,
        hasWhatsapp: false,
        hasUsers: true,
        requiresSetupToken: false,
      });
    });

    it('blocks a second setup with 409', async () => {
      await request(server).post('/setup').send(validSetup).expect(409);
    });

    it('blocks step validation once initialized (409)', async () => {
      await request(server)
        .post('/setup/validate')
        .send({ step: 'company', company: { name: 'Otra' } })
        .expect(409);
    });

    it('authenticates the created admin and serves its company', async () => {
      const agent = request.agent(server);

      await agent
        .post('/auth/login')
        .send({ username: 'admin', password: 'secreta-123' })
        .expect(200);

      // The session hydrates the front: profile + the company list it picks from.
      const me = await agent.get('/auth/me').expect(200);
      const meBody = me.body as {
        user: {
          username: string;
          memberships: Array<{ companyId: string; role: string }>;
        } | null;
      };

      expect(meBody.user?.username).toBe('admin');
      expect(meBody.user?.memberships).toEqual([
        expect.objectContaining({ companyId, role: 'admin', status: 'active' }),
      ]);

      // The admin membership created by /setup is in the token: the new
      // company is usable right away as the active company.
      const res = await agent
        .get('/company-members/current')
        .set('x-company-id', companyId)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({ companyId, role: 'admin', status: 'active' }),
      );
    });

    it('gives the company a pending whatsapp channel with a verify token', async () => {
      const agent = request.agent(server);
      await agent
        .post('/auth/login')
        .send({ username: 'admin', password: 'secreta-123' })
        .expect(200);

      const res = await agent
        .get('/channels/whatsapp/config')
        .set('x-company-id', companyId)
        .expect(200);

      const body = res.body as {
        type: string;
        status: string;
        externalAccountId: string | null;
        hasCredentials: boolean;
        webhookVerifyToken: string | null;
      };
      expect(body).toMatchObject({
        type: 'whatsapp',
        status: 'pending',
        externalAccountId: null,
        hasCredentials: false,
      });
      expect(body.webhookVerifyToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('protects the connection test with the session (401 without it)', async () => {
      await request(server)
        .post('/channels/whatsapp/test')
        .set('x-company-id', companyId)
        .expect(401);
    });

    it('reports the pending channel as not ready to send', async () => {
      const agent = request.agent(server);
      await agent
        .post('/auth/login')
        .send({ username: 'admin', password: 'secreta-123' })
        .expect(200);

      const res = await agent
        .post('/channels/whatsapp/test')
        .set('x-company-id', companyId)
        .expect(200);

      expect(res.body).toMatchObject({
        ok: false,
        sending: { status: 'skipped' },
        webhook: { status: 'skipped' },
        subscription: { status: 'skipped' },
      });
      expect(metaProbe.probe).not.toHaveBeenCalled();
    });

    it('rejects an empty login payload with the standard 400 envelope', async () => {
      const res = await request(server)
        .post('/auth/login')
        .send({})
        .expect(400);
      const body = res.body as {
        statusCode: number;
        error: string;
        message: string[];
      };

      expect(body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
      });
      expect(body.message).toEqual([
        'El campo username es obligatorio.',
        'El campo password es obligatorio.',
      ]);
    });
  });

  describe('workspace with whatsapp configured', () => {
    let app: INestApplication;
    let server: App;

    beforeAll(async () => {
      app = await createApp();
      server = app.getHttpServer() as App;
    });

    afterAll(async () => {
      await app.close();
    });

    it('stores the whatsapp channel and flags it in the status', async () => {
      const created = await request(server)
        .post('/setup')
        .send({
          ...validSetup,
          whatsapp: {
            businessId: 'biz-1',
            accessToken: 'token',
            externalAccountId: 'phone-1',
            webhookUrl: 'http://localhost:3000/integration/webhook/whatsapp',
          },
        })
        .expect(201);
      const createdBody = created.body as SetupResultBody;

      expect(createdBody.channel?.id).toBeDefined();
      expect(createdBody.channel?.webhookVerifyToken).toBeDefined();

      const res = await request(server).get('/setup/status').expect(200);
      const body = res.body as SetupStatusBody;

      expect(body.initialized).toBe(true);
      expect(body.hasWhatsapp).toBe(true);

      // The pending channel the company was born with was filled in place.
      const channels = await app.get(DataSource).getRepository(Channel).find();
      expect(channels).toHaveLength(1);
      expect(channels[0]).toMatchObject({
        id: createdBody.channel?.id,
        status: 'active',
        externalAccountId: 'phone-1',
        webhookVerifyToken: createdBody.channel?.webhookVerifyToken,
      });
    });
  });

  describe('whatsapp with its own Meta App Secret', () => {
    let app: INestApplication;
    let server: App;

    beforeAll(async () => {
      app = await createApp();
      server = app.getHttpServer() as App;
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects an App Secret that is not 32 hex chars', async () => {
      await request(server)
        .post('/setup')
        .send({
          ...validSetup,
          whatsapp: {
            accessToken: 'token',
            externalAccountId: 'phone-1',
            appSecret: 'not-a-secret',
          },
        })
        .expect(400);
    });

    it('stores the App Secret without ever returning it', async () => {
      const appSecret = '0123456789abcdef0123456789ABCDEF';
      const res = await request(server)
        .post('/setup')
        .send({
          ...validSetup,
          whatsapp: { accessToken: 'token', externalAccountId: 'phone-1', appSecret },
        })
        .expect(201);

      expect(JSON.stringify(res.body)).not.toContain(appSecret);
      expect((res.body as SetupResultBody).channel?.id).toBeDefined();
    });
  });

  describe('workspace protected by a setup token', () => {
    let app: INestApplication;
    let server: App;

    beforeAll(async () => {
      app = await createApp('token-de-prueba');
      server = app.getHttpServer() as App;
    });

    afterAll(async () => {
      await app.close();
    });

    it('flags that a token is required', async () => {
      const res = await request(server).get('/setup/status').expect(200);
      const body = res.body as SetupStatusBody;

      expect(body.requiresSetupToken).toBe(true);
      expect(body.initialized).toBe(false);
    });

    it('rejects a setup without the token', async () => {
      await request(server).post('/setup').send(validSetup).expect(403);
    });

    it('rejects a setup with a wrong token', async () => {
      await request(server)
        .post('/setup')
        .send({ ...validSetup, setupToken: 'incorrecto' })
        .expect(403);
    });

    it('reports a wrong token on the token step, before any other step', async () => {
      const res = await request(server)
        .post('/setup/validate')
        .send({ step: 'token', setupToken: 'incorrecto' })
        .expect(200);

      expect(res.body).toMatchObject({
        ok: false,
        errors: [{ path: 'setupToken' }],
      });
    });

    it('validates a later step only with the token (403 without it)', async () => {
      const whatsapp = { accessToken: 'token', externalAccountId: '123456' };
      await request(server)
        .post('/setup/validate')
        .send({ step: 'whatsapp', whatsapp })
        .expect(403);

      const res = await request(server)
        .post('/setup/validate')
        .send({ step: 'whatsapp', setupToken: 'token-de-prueba', whatsapp })
        .expect(200);

      expect(res.body).toMatchObject({
        ok: true,
        whatsapp: { displayPhoneNumber: '+51 999 999 999' },
      });
    });

    it('rejects a malformed step payload with 400', async () => {
      await request(server)
        .post('/setup/validate')
        .send({ step: 'nope' })
        .expect(400);
    });

    it('accepts a setup with the right token', async () => {
      await request(server)
        .post('/setup')
        .send({ ...validSetup, setupToken: 'token-de-prueba' })
        .expect(201);
    });
  });
});
