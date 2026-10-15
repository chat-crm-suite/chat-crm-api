// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { UnauthorizedException } from '@nestjs/common';

import type { JwtPayload } from '../auth/auth.types';
import type { SessionRevocationService } from '../auth/session/session-revocation.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const payload: JwtPayload = {
    sub: 'user-1',
    memberships: [{ cid: 'company-1', mid: 'member-1', role: 'agent' }],
    ts: 1,
  };

  const strategyWith = (stale: boolean) =>
    new JwtStrategy({
      isStale: jest.fn().mockResolvedValue(stale),
    } as unknown as SessionRevocationService);

  it('returns the verified claims of a fresh token', async () => {
    await expect(strategyWith(false).validate(payload)).resolves.toBe(payload);
  });

  it('answers 401 token_stale so the client refreshes instead of logging out', async () => {
    const error = await strategyWith(true)
      .validate(payload)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      statusCode: 401,
      code: 'token_stale',
    });
  });
});
