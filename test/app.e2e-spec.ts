import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Requires live infra: MySQL + Redis reachable with the current env.
// From host (Windows/Git Bash): start the dev stack first so that
// localhost:3306/6379 forward to mysql/redis, then run with
// DB_HOST=localhost REDIS_HOST=localhost pnpm run test:e2e
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('/health/ready (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.checks.redis).toBe('ok');
    expect(res.body.checks.bullmq).toBe('ok');
  });
});
