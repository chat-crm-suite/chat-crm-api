// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { JwtPayload } from '../../auth/auth.types';
import { isPlatformConsoleEnabled, PLATFORM_COOKIE } from './platform.config';
import { PlatformService } from './platform.service';

/**
 * Gate of the console routes (`@UseGuards(PlatformGuard)`), independent from
 * the tenant guard (these routes are `@UserScoped`, no `x-company-id`):
 *
 * - console off (no `PLATFORM_CONSOLE_PASSWORD`) -> 404, as if it did not exist;
 * - the session is already valid and fresh when this runs (global
 *   `JwtAuthGuard`), then the `platform_token` must be valid, belong to that
 *   same user and the user must still be a platform admin -> otherwise 403
 *   `platform_locked`.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly platform: PlatformService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (!isPlatformConsoleEnabled()) throw new NotFoundException();

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const sub = req.user?.sub;
    if (!sub) throw new UnauthorizedException();

    const token = (req.cookies as Record<string, unknown> | undefined)?.[PLATFORM_COOKIE];
    if (!(await this.platform.isUnlocked(sub, token))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'platform_locked',
        message: 'The platform console is locked',
      });
    }

    return true;
  }
}
