// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { ClsModule } from 'nestjs-cls';
import { I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, EntityTarget } from 'typeorm';

import { AuthModule } from '@auth/auth.module';
import { clsConfig } from '@config/cls.config';
import { i18nConfig } from '@config/i18n.config';
import { loggerConfig } from '@config/logger.config';
import type { MemberRole } from '@contracts';
import * as Entities from '@entities';
import { IaModule } from '@modules/analysis/ia/ia.module';
import { KillSwitchService } from '@modules/analysis/ia/kill-switch.service';
import { CompanyMember } from '@modules/company-members/entities/company-member.entity';
import { Company } from '@modules/company/entities/company.entity';
import { User } from '@modules/users/entities/user.entity';
import { getTestConfig } from './helpers/test-database.helper';

const entities = Object.values(Entities) as EntityTarget<unknown>[];

jest.setTimeout(180_000);

/** Same password the factories hash; seeded here to keep faker (ESM) out. */
const PASSWORD = 'Test1234!';

/**
 * T2: `POST /admin/ia/toggle` follows the existing privileged-endpoint
 * pattern: JWT + active company context, and only an active company admin may
 * flip the kill switch. It answers with the resulting state. The kill switch
 * itself is mocked here, so the suite never touches the shared Redis.
 */
describe('Admin IA toggle (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let dataSource: DataSource;
  let company: Company;
  let otherCompany: Company;
  let admin: User;
  let agent: User;
  let foreignAdmin: User;

  const killSwitch = {
    isEnabled: jest.fn(),
    setEnabled: jest.fn(),
  };

  const createUser = async (username: string): Promise<User> => {
    const users = dataSource.getRepository(User);

    return users.save(
      users.create({ username, passwordHash: await bcrypt.hash(PASSWORD, 4) }),
    );
  };

  const createCompany = async (name: string): Promise<Company> => {
    const companies = dataSource.getRepository(Company);

    return companies.save(companies.create({ name }));
  };

  const addMember = async (
    userId: string,
    companyId: string,
    role: MemberRole,
  ): Promise<void> => {
    const members = dataSource.getRepository(CompanyMember);

    await members.save(
      members.create({ userId, companyId, role, status: 'active' }),
    );
  };

  const login = async (username: string) => {
    const agentSession = request.agent(server);
    await agentSession
      .post('/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);

    return agentSession;
  };

  beforeAll(async () => {
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
        AuthModule,
        IaModule,
      ],
    })
      .overrideProvider(KillSwitchService)
      .useValue(killSwitch)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(false);
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();

    server = app.getHttpServer() as App;
    dataSource = app.get<DataSource>(getDataSourceToken());

    company = await createCompany('company-t2');
    otherCompany = await createCompany('company-other-t2');

    admin = await createUser('admin-t2');
    agent = await createUser('agent-t2');
    foreignAdmin = await createUser('foreign-admin-t2');

    await addMember(admin.id, company.id, 'admin');
    await addMember(agent.id, company.id, 'agent');
    await addMember(foreignAdmin.id, otherCompany.id, 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    killSwitch.setEnabled.mockImplementation((enabled: boolean) =>
      Promise.resolve(enabled),
    );
  });

  it('rejects an anonymous request with 401', async () => {
    await request(server)
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: false })
      .expect(401);

    expect(killSwitch.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects an admin without the active company context with 403', async () => {
    const session = await login('admin-t2');

    await session
      .post('/admin/ia/toggle')
      .send({ enabled: false })
      .expect(403);

    expect(killSwitch.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects a non-admin member with 403 and never writes the flag', async () => {
    const session = await login('agent-t2');

    await session
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: false })
      .expect(403);

    expect(killSwitch.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects an admin of another company with 403 (foreign tenant)', async () => {
    const session = await login('foreign-admin-t2');

    await session
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: false })
      .expect(403);

    expect(killSwitch.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects an invalid body with 400', async () => {
    const session = await login('admin-t2');

    await session
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: 'yes' })
      .expect(400);

    expect(killSwitch.setEnabled).not.toHaveBeenCalled();
  });

  it('turns the IA off and answers the resulting state', async () => {
    const session = await login('admin-t2');

    const res = await session
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: false })
      .expect(200);

    expect(res.body).toEqual({ enabled: false });
    expect(killSwitch.setEnabled).toHaveBeenCalledWith(false);
  });

  it('turns the IA back on and answers the resulting state', async () => {
    const session = await login('admin-t2');

    const res = await session
      .post('/admin/ia/toggle')
      .set('x-company-id', company.id)
      .send({ enabled: true })
      .expect(200);

    expect(res.body).toEqual({ enabled: true });
    expect(killSwitch.setEnabled).toHaveBeenCalledWith(true);
  });
});
