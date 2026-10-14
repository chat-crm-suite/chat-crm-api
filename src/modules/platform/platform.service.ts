// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import type { PlatformStatus } from '../../contracts/index';
import { User } from '../users/entities/user.entity';
import { PlatformRateLimiter } from './platform-rate-limiter';
import { PlatformTokenService } from './platform-token.service';
import {
  getPlatformPassword,
  isPlatformConsoleEnabled,
  passwordMatches,
  PLATFORM_MAX_FAILED_ATTEMPTS,
} from './platform.config';

/**
 * Access to the platform console: the console only exists when
 * `PLATFORM_CONSOLE_PASSWORD` is set, and only a platform admin (re-read from
 * the database, never trusted from the token) who knows that password gets a
 * `platform_token`. Every attempt is audit-logged without the password.
 */
@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tokens: PlatformTokenService,
    private readonly limiter: PlatformRateLimiter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformService.name);
  }

  /** Every console route but `status` answers 404 while the console is off. */
  assertEnabled(): void {
    if (!isPlatformConsoleEnabled()) throw new NotFoundException();
  }

  async status(userId: string, platformToken: unknown): Promise<PlatformStatus> {
    if (!isPlatformConsoleEnabled()) return { enabled: false, unlocked: false };

    const claims = await this.claimsOf(userId, platformToken);

    return {
      enabled: true,
      unlocked: claims !== null,
      expiresAt: claims?.expiresAt ?? null,
    };
  }

  /** True when the token is valid, belongs to `userId` and the user is still a platform admin. */
  async isUnlocked(userId: string, platformToken: unknown): Promise<boolean> {
    return (await this.claimsOf(userId, platformToken)) !== null;
  }

  async unlock(
    userId: string,
    password: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    this.assertEnabled();

    if (!(await this.isPlatformAdmin(userId))) {
      this.audit('unlock_denied', userId, 'not_platform_admin');
      throw new ForbiddenException({
        statusCode: 403,
        code: 'platform_forbidden',
        message: 'This account cannot open the platform console',
      });
    }

    const retryAfterSec = await this.limiter.retryAfterSec(userId);
    if (retryAfterSec > 0) {
      this.audit('unlock_blocked', userId, 'rate_limited');
      throw new HttpException(
        {
          statusCode: 429,
          code: 'platform_rate_limited',
          message: 'Too many failed attempts. Try again later',
          enabled: true,
          unlocked: false,
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!passwordMatches(password, getPlatformPassword() as string)) {
      const attempts = await this.limiter.registerFailure(userId);
      this.audit('unlock_failed', userId, 'invalid_password', {
        attempts,
        remaining: Math.max(0, PLATFORM_MAX_FAILED_ATTEMPTS - attempts),
      });
      throw new ForbiddenException({
        statusCode: 403,
        code: 'platform_invalid_password',
        message: 'Invalid console password',
      });
    }

    await this.limiter.clear(userId);
    const signed = await this.tokens.sign(userId);
    this.audit('unlock_succeeded', userId);

    return signed;
  }

  lock(userId: string): void {
    this.assertEnabled();
    this.audit('locked', userId);
  }

  private async claimsOf(userId: string, platformToken: unknown) {
    const claims = await this.tokens.verify(platformToken);
    if (!claims || claims.sub !== userId) return null;
    if (!(await this.isPlatformAdmin(userId))) return null;

    return claims;
  }

  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, isPlatformAdmin: true },
    });

    return user?.isPlatformAdmin === true;
  }

  private audit(
    event: string,
    userId: string,
    reason?: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.info(
      { audit: 'platform', event, userId, reason, ...extra },
      `platform console: ${event}`,
    );
  }
}
