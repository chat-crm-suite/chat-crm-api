// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AUTH_ERROR_CODES } from '../contracts/index';
import { JwtPayload } from '../auth/auth.types';
import { getJwtSecret } from '../auth/jwt.config';
import { SessionRevocationService } from '../auth/session/session-revocation.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessions: SessionRevocationService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        (req: Request) => req.cookies['access_token'],
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  /**
   * The signature is valid; reject tokens whose memberships may be outdated
   * so the client refreshes them (`token_stale`) instead of logging out.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (await this.sessions.isStale(payload)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: AUTH_ERROR_CODES.tokenStale,
        message: 'Session memberships changed; refresh required',
      });
    }

    return payload;
  }
}
