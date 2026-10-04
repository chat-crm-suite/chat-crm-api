import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthModule } from '../src/auth/auth.module';
import { loggerConfig } from '../src/config/logger.config';
import { clsConfig } from '../src/config/cls.config';
import {
  Analysis,
  Chat,
  Company,
  Contact,
  Message,
  Notification,
  SentimentAnalysis,
  User,
  WhatsAppConfig,
} from '../src/entities/index';
import { WhatsAppMessageDetail } from '../src/integrations/whatsapp/entities/index';
import { WhatsAppConfigSubscriber } from '../src/integrations/whatsapp/subscribers/whatsapp-config.subscriber';
import { ChatAssignments, Transfer } from '../src/modules/chats/entities/index';
import { Member } from '../src/modules/member/member.entity';
import { SetupModule } from '../src/modules/setup/setup.module';
import { getTestSQLiteConfig } from './helpers/test-database.helper';

interface SetupStatusBody {
  initialized: boolean;
  hasAdmin: boolean;
  hasCompany: boolean;
  hasWhatsapp: boolean;
}

interface SetupResultBody {
  user: { id: string; username: string };
  company: { id: string; name: string };
  whatsapp: { id: string; webhookVerifyToken: string } | null;
}

const entities = [
  Analysis,
  Chat,
  ChatAssignments,
  Company,
  Contact,
  Member,
  Message,
  Notification,
  SentimentAnalysis,
  Transfer,
  User,
  WhatsAppConfig,
  WhatsAppMessageDetail,
];

// Flujo de primer arranque sobre SQLite en memoria (sin MySQL/Redis).
// Cubre el contrato de `setup` y que la sesión creada sirve para autenticar.
const createApp = async (): Promise<INestApplication> => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      LoggerModule.forRoot(loggerConfig),
      ClsModule.forRoot(clsConfig),
      TypeOrmModule.forRoot(getTestSQLiteConfig(entities)),
      SetupModule,
      AuthModule,
    ],
    providers: [WhatsAppConfigSubscriber],
  }).compile();

  // El bootstrap por env no debe contaminar una BD "recién instalada".
  process.env.BOOTSTRAP_ADMIN_USERNAME = '';
  process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
  process.env.BOOTSTRAP_COMPANY_NAME = '';

  const app = moduleFixture.createNestApplication();
  app.useLogger(false);
  app.use(cookieParser());
  await app.init();

  return app;
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
      });
    });

    it('creates admin, company and membership in a single call', async () => {
      const res = await request(server)
        .post('/setup')
        .send({
          admin: { username: 'admin', password: 'secreta-123' },
          company: { name: 'J&P Perifericos' },
        })
        .expect(201);
      const body = res.body as SetupResultBody;

      expect(body.company.name).toBe('J&P Perifericos');
      expect(body.whatsapp).toBeNull();
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
      });
    });

    it('blocks a second setup with 409', async () => {
      await request(server)
        .post('/setup')
        .send({
          admin: { username: 'admin', password: 'secreta-123' },
          company: { name: 'Otra empresa' },
        })
        .expect(409);
    });

    it('authenticates the created admin and serves its company', async () => {
      const agent = request.agent(server);

      await agent
        .post('/auth/login')
        .send({ username: 'admin', password: 'secreta-123' })
        .expect(200);

      // La sesión sirve para hidratar el front (user + empresa activa).
      const me = await agent.get('/auth/me').expect(200);
      const meBody = me.body as {
        user: { username: string } | null;
        company: { id: string | null };
      };

      expect(meBody.user?.username).toBe('admin');
      expect(meBody.company.id).toBe(companyId);

      // La membresía admin creada por /setup pertenece a la empresa creada.
      const res = await agent.get('/auth/me/companies').expect(200);
      const body = res.body as string[];

      expect(body).toEqual([companyId]);
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

    it('stores the whatsapp config and flags it in the status', async () => {
      const created = await request(server)
        .post('/setup')
        .send({
          admin: { username: 'admin', password: 'secreta-123' },
          company: { name: 'J&P Perifericos' },
          whatsapp: {
            businessId: 'biz-1',
            accessToken: 'token',
            phoneNumberId: 'phone-1',
            webhookUrl: 'http://localhost:3000/integration/webhook/whatsapp',
          },
        })
        .expect(201);
      const createdBody = created.body as SetupResultBody;

      expect(createdBody.whatsapp?.id).toBeDefined();
      expect(createdBody.whatsapp?.webhookVerifyToken).toBeDefined();

      const res = await request(server).get('/setup/status').expect(200);
      const body = res.body as SetupStatusBody;

      expect(body.initialized).toBe(true);
      expect(body.hasWhatsapp).toBe(true);
    });
  });
});
