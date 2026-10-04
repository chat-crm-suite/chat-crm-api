import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    @InjectQueue('chat') private readonly chatQueue: Queue,
  ) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  @Get('health/ready')
  async getReady() {
    const checks: Record<string, string> = {
      database: 'unknown',
      redis: 'unknown',
      bullmq: 'unknown',
      ia: 'skipped',
    };

    try {
      await this.dataSource.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }

    const redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
    } finally {
      redis.disconnect();
    }

    try {
      await this.chatQueue.getJobCounts();
      checks.bullmq = 'ok';
    } catch {
      checks.bullmq = 'fail';
    }

    const iaUrl = process.env.IA_URL;
    if (iaUrl) {
      try {
        const res = await fetch(`${iaUrl}/health`, { signal: AbortSignal.timeout(2000) });
        checks.ia = res.ok ? 'ok' : 'unreachable';
      } catch {
        checks.ia = 'unreachable';
      }
    }

    const failed = checks.database !== 'ok' || checks.redis !== 'ok' || checks.bullmq !== 'ok';
    const body = {
      status: failed ? 'not-ready' : 'ready',
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    if (failed) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
