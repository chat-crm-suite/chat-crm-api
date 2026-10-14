// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentUser, UserScoped } from '@auth';
import { PlatformStatusSchema, type PlatformStatus } from '@contracts';
import { PlatformUnlockDto } from './dto/platform.dto';
import {
  PLATFORM_COOKIE,
  PLATFORM_TOKEN_TTL_SECONDS,
} from './platform.config';
import { PlatformService } from './platform.service';

/** Same flags on set and clear, or the browser keeps the old cookie. */
function platformCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
  };
}

/**
 * Lock state of the platform console. Needs a session but no company
 * (`@UserScoped`); the console routes themselves are in
 * `PlatformCompaniesController`, behind `PlatformGuard`.
 */
@ApiTags('Platform')
@ApiCookieAuth('access_token')
@UserScoped()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  /** 200 even while the console is off, so the app can hide the entry. */
  @Get('status')
  @ApiOperation({ summary: 'Platform console availability and lock state' })
  @ZodSerializerDto(PlatformStatusSchema)
  @ApiOkResponse({ description: 'Console status' })
  status(
    @CurrentUser('sub') userId: string,
    @Req() req: Request,
  ): Promise<PlatformStatus> {
    return this.platform.status(userId, this.tokenOf(req));
  }

  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock the console with the console password (platform admins)' })
  @ZodSerializerDto(PlatformStatusSchema)
  @ApiOkResponse({ description: 'Console status' })
  async unlock(
    @CurrentUser('sub') userId: string,
    @Body() dto: PlatformUnlockDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformStatus> {
    const { token, expiresAt } = await this.platform.unlock(userId, dto.password);

    res.cookie(PLATFORM_COOKIE, token, {
      ...platformCookieOptions(),
      maxAge: PLATFORM_TOKEN_TTL_SECONDS * 1000,
    });

    return { enabled: true, unlocked: true, expiresAt };
  }

  @Post('lock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock the console again' })
  @ZodSerializerDto(PlatformStatusSchema)
  @ApiOkResponse({ description: 'Console status' })
  lock(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): PlatformStatus {
    this.platform.lock(userId);
    res.clearCookie(PLATFORM_COOKIE, platformCookieOptions());

    return { enabled: true, unlocked: false };
  }

  private tokenOf(req: Request): unknown {
    return (req.cookies as Record<string, unknown> | undefined)?.[PLATFORM_COOKIE];
  }
}
