// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ChangePasswordDto } from '../modules/users/dto/profile.dto';
import { UsersService } from '../modules/users/users.service';
import { setAuthCookie } from './auth.controller';
import { AuthService } from './auth.service';
import { UserScoped } from './decorators/access.decorators';
import { CurrentUser } from './decorators/current-user.decorator';

/**
 * Session-sensitive part of `users/me`. It lives in the auth module because
 * keeping the caller logged in after a password change means issuing a token,
 * which only `AuthService` can do (the users module sits below it).
 */
@ApiTags('Users')
@ApiCookieAuth('access_token')
@UserScoped()
@Controller('users/me')
export class AccountController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Changes the caller's password and ends every other session. The session
   * that made the change keeps working: it gets a fresh cookie issued after
   * the revocation, so its token is not older than the stale marker.
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change my password; other sessions are closed' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.users.changePassword(dto);
    setAuthCookie(res, await this.auth.issueToken(userId));

    return { message: 'Password changed' };
  }
}
