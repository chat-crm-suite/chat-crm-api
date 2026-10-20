// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import type { Server, ServerOptions } from 'socket.io';

/** How long boot waits for Redis before falling back to in-process rooms. */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Socket.io over Redis pub/sub: an emit to a room reaches sockets held by any
 * API process, so realtime keeps working with more than one instance and
 * across rolling restarts. If Redis is unreachable at boot the app still
 * starts with the default in-process adapter (single instance is fine).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly log: PinoLogger,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pub = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
    });
    const sub = pub.duplicate();
    pub.on('error', (err: Error) => this.log.warn({ err }, 'Socket Redis (pub) error'));
    sub.on('error', (err: Error) => this.log.warn({ err }, 'Socket Redis (sub) error'));

    try {
      await withTimeout(Promise.all([pub.connect(), sub.connect()]), CONNECT_TIMEOUT_MS);
      this.clients = [pub, sub];
      this.adapterConstructor = createAdapter(pub, sub);
      this.log.info('Socket.io Redis adapter enabled');
    } catch (error) {
      pub.disconnect();
      sub.disconnect();
      this.log.warn(
        { error: String(error) },
        'Socket.io Redis adapter unavailable: rooms stay in-process',
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);

    return server;
  }

  async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await super.close(server);
    this.clients.forEach((client) => client.disconnect());
    this.clients = [];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
