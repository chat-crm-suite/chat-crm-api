// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ExecutionContext } from '@nestjs/common';
import { factory } from './current-user.decorator';
import type { JwtPayload } from '../auth.types';

const contextWith = (user: JwtPayload | undefined) =>
  ({
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ user }),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
  }) as unknown as ExecutionContext;

describe('CurrentUser factory', () => {
  const payload: JwtPayload = {
    sub: 'user-1',
    memberships: [{ cid: 'company-1', mid: 'member-1', role: 'admin' }],
    ts: 1,
  };

  it('returns the verified claims when no data is provided', () => {
    expect(factory(undefined, contextWith(payload))).toEqual(payload);
  });

  it('returns one claim when data is given', () => {
    expect(factory('sub', contextWith(payload))).toBe('user-1');
    expect(factory('memberships', contextWith(payload))).toEqual(payload.memberships);
  });

  it('returns undefined when the request has no user', () => {
    expect(factory(undefined, contextWith(undefined))).toBeUndefined();
    expect(factory('sub', contextWith(undefined))).toBeUndefined();
  });
});
