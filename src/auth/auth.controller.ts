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
  UnauthorizedException,
} from '@nestjs/common';

import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';

import { AuthSessionResponseSchema, type AuthSessionResponse } from '../contracts/index';
import { UsersService } from '../modules/users/users.service';
import { AuthService } from './auth.service';
import { SessionRevocationService } from './session/session-revocation.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public, UserScoped } from './decorators/access.decorators';
import type { JwtPayload } from './auth.types';

export const ACCESS_TOKEN_COOKIE = 'access_token';

/** Single place for the session cookie flags (login and refresh). */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax', // 'none' in https
    secure: process.env.COOKIE_SECURE === '1',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly users: UsersService,
    private readonly sessions: SessionRevocationService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.service.sign(body);
    setAuthCookie(res, token);

    return { message: 'Login Success' };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { message: string } {
    res.clearCookie(ACCESS_TOKEN_COOKIE);
    return { message: 'Logout success' };
  }

  /**
   * "Sign out everywhere": every token of the caller issued until now becomes
   * stale (their sockets drop too) and the cookie of this browser is cleared.
   */
  @UserScoped()
  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.sessions.revoke(userId);
    res.clearCookie(ACCESS_TOKEN_COOKIE);

    return { message: 'All sessions revoked' };
  }

  /**
   * Profile plus every membership: the client keeps this list and picks the
   * active company locally, sending it as `x-company-id` on each request.
   */
  @UserScoped()
  @Get('me')
  @ZodSerializerDto(AuthSessionResponseSchema)
  async getProfile(@CurrentUser() user: JwtPayload): Promise<AuthSessionResponse> {
    return { user: await this.requireProfile(user.sub) };
  }

  /**
   * Reissues the session cookie with the current memberships after a
   * `token_stale` answer. Public because the global guard rejects the stale
   * token itself; the service still verifies its signature and expiry.
   */
  @Public()
  @Post('refresh-memberships')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(AuthSessionResponseSchema)
  async refreshMemberships(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const { token, userId } = await this.service.refreshMemberships(
      req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined,
    );
    setAuthCookie(res, token);

    return { user: await this.requireProfile(userId) };
  }

  private async requireProfile(userId: string) {
    const profile = await this.users.profile(userId);
    if (!profile) throw new UnauthorizedException();

    return profile;
  }
}
