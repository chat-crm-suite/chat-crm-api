// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

/**
 * Single place that boots the HTTP app, so `main.ts` and tests share the
 * same wiring.
 *
 * `rawBody: true` keeps the raw request bytes on `req.rawBody` (in addition
 * to the parsed body). The WhatsApp webhook needs those exact bytes to
 * verify Meta's `X-Hub-Signature-256`; without them every signed post would
 * fail closed with 403.
 */
export function createNestApp(
  module: Parameters<typeof NestFactory.create>[0],
): Promise<INestApplication> {
  return NestFactory.create(module, { bufferLogs: true, rawBody: true });
}
