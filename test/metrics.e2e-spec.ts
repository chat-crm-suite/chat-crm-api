// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@src/app.module';

// Requires live infra: MySQL + Redis reachable with the current env, same as
// health.e2e-spec. The real snapshot service is exercised (counters from
// Redis, breaker state, backlog from MySQL), so only the JSON structure is
// asserted — the exact values belong to the unit suite.
jest.setTimeout(120_000);

describe('MetricsController (e2e)', () => {
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

  it('/metrics (GET) serves the counter snapshot without auth', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    const body = res.body as Record<string, unknown>;

    expect(body.windowSeconds).toBe(86_400);

    const counts = body.counts as Record<string, unknown>;
    const skipped = counts.skipped as Record<string, unknown>;
    expect(Object.keys(counts).sort()).toEqual([
      'completed',
      'failed',
      'retryEnqueued',
      'skipped',
    ]);
    expect(Object.keys(skipped).sort()).toEqual([
      'circuit_breaker',
      'ia_unavailable',
      'kill_switch',
    ]);
    for (const value of [
      counts.completed,
      counts.failed,
      counts.retryEnqueued,
      ...Object.values(skipped),
    ]) {
      expect(typeof value).toBe('number');
    }

    const latency = body.iaLatencyMs as {
      last: unknown;
      avg: unknown;
      samples: unknown;
    };
    expect(Object.keys(latency).sort()).toEqual(['avg', 'last', 'samples']);
    expect(latency.last === null || typeof latency.last === 'number').toBe(
      true,
    );
    expect(latency.avg === null || typeof latency.avg === 'number').toBe(true);
    expect(typeof latency.samples).toBe('number');
    expect(['closed', 'open', 'half-open']).toContain(body.circuitBreaker);
    expect(typeof body.retryBacklog).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });
});
