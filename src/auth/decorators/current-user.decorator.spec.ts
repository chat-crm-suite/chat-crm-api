// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ExecutionContext } from '@nestjs/common';
import { factory } from './current-user.decorator';
import { AuthUser } from '../auth.types';

describe('extractUser', () => {
  const authUser: Partial<AuthUser> = {
    id: '123',
    username: 'jeremi',
  };

  const mockContext = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ user: authUser }),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
  } as unknown as ExecutionContext;

  it('returns full user when no data is provided', () => {
    expect(factory(undefined, mockContext)).toEqual(authUser);
  });

  it('returns user id when data is "id"', () => {
    expect(factory('id', mockContext)).toBe(authUser.id);
  });

  it('returns user username when data is "username"', () => {
    expect(factory('username', mockContext)).toBe(authUser.username);
  });

  it('returns undefined if user is missing', () => {
    const badContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user: undefined }),
        getResponse: jest.fn(),
        getNext: jest.fn(),
      }),
    } as unknown as ExecutionContext;

    expect(factory(undefined, badContext)).toBeUndefined();
  });
});