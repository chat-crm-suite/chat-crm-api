// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  getPlatformSigningKey,
  PLATFORM_AUDIENCE,
  PLATFORM_TOKEN_TTL_SECONDS,
} from './platform.config';

export type PlatformTokenClaims = { sub: string; expiresAt: Date };

/**
 * Signs and verifies the `platform_token`: a short-lived JWT (`aud:
 * 'platform'`) bound to one user, under a key derived from `JWT_SECRET`.
 */
@Injectable()
export class PlatformTokenService {
  constructor(private readonly jwt: JwtService) {}

  async sign(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: getPlatformSigningKey(),
        algorithm: 'HS256',
        audience: PLATFORM_AUDIENCE,
        expiresIn: PLATFORM_TOKEN_TTL_SECONDS,
      },
    );

    return {
      token,
      expiresAt: new Date(Date.now() + PLATFORM_TOKEN_TTL_SECONDS * 1000),
    };
  }

  /** Claims of a valid, unexpired platform token; `null` for anything else. */
  async verify(token: unknown): Promise<PlatformTokenClaims | null> {
    if (typeof token !== 'string' || !token) return null;

    try {
      const claims = await this.jwt.verifyAsync<{ sub?: string; exp?: number }>(
        token,
        {
          secret: getPlatformSigningKey(),
          algorithms: ['HS256'],
          audience: PLATFORM_AUDIENCE,
        },
      );
      if (!claims.sub || !claims.exp) return null;

      return { sub: claims.sub, expiresAt: new Date(claims.exp * 1000) };
    } catch {
      return null;
    }
  }
}
