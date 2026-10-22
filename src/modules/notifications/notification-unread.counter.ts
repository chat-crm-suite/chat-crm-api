// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { IsNull, Repository } from 'typeorm';

import { APP_REDIS, type AppRedis } from '../../common/redis/app-redis.module';
import { Notification } from './entities/notification.entity';

/** A stale badge heals itself within this window even if a write was lost. */
export const UNREAD_CACHE_TTL_MS = 10 * 60 * 1000;

export const unreadKey = (memberId: string) => `notif:unread:${memberId}`;

/**
 * Unread badge per company member (a member belongs to one company, so the
 * member id already scopes it). MySQL is the truth: every write recounts with
 * one indexed COUNT and stores the result, reads hit Redis first. Redis down
 * = straight to MySQL, never an error.
 */
@Injectable()
export class NotificationUnreadCounter {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationUnreadCounter.name);
  }

  async get(memberId: string): Promise<number> {
    try {
      const cached = await this.redis.get(unreadKey(memberId));
      if (cached !== null) return Number(cached);
    } catch (error) {
      this.logger.debug({ error: String(error) }, 'Unread cache read failed');
    }

    return this.refresh(memberId);
  }

  /** Recounts from MySQL and caches the result; call after every write. */
  async refresh(memberId: string): Promise<number> {
    const count = await this.notificationRepo.count({
      where: { recipientMemberId: memberId, readAt: IsNull() },
    });

    try {
      await this.redis.set(unreadKey(memberId), String(count), 'PX', UNREAD_CACHE_TTL_MS);
    } catch (error) {
      this.logger.debug({ error: String(error) }, 'Unread cache write failed');
    }

    return count;
  }
}
