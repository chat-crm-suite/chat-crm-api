// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Module, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createNestApp } from './nest-app.factory';

let seen: { rawBody?: Buffer; body?: unknown } | undefined;

@Controller('probe')
class ProbeController {
  @Post()
  capture(@Req() req: RawBodyRequest<Request>) {
    seen = { rawBody: req.rawBody, body: req.body };
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * The WhatsApp webhook verifies Meta's signature over the *raw* request
 * bytes (`X-Hub-Signature-256`); the parsed body alone is not byte-identical
 * to what Meta signed. This pins the app wiring that delivers those bytes.
 */
describe('createNestApp raw body wiring', () => {
  it('exposes the exact request bytes alongside the parsed body', async () => {
    const raw = '{"object":"whatsapp_business_account","n":1}';
    const app = await createNestApp(ProbeModule);
    await app.init();

    try {
      await request(app.getHttpServer() as App)
        .post('/probe')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(201);

      expect(seen?.rawBody?.toString('utf8')).toBe(raw);
      expect(seen?.body).toEqual({
        object: 'whatsapp_business_account',
        n: 1,
      });
    } finally {
      await app.close();
    }
  });
});
