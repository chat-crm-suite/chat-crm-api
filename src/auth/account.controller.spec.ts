// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import type { UsersService } from '../modules/users/users.service';
import { AccountController } from './account.controller';
import type { AuthService } from './auth.service';
import { IS_USER_SCOPED_KEY } from './decorators/access.decorators';

describe('AccountController', () => {
  const order: string[] = [];
  const users = {
    changePassword: jest.fn(() => {
      order.push('changePassword');
      return Promise.resolve();
    }),
  };
  const auth = {
    issueToken: jest.fn(() => {
      order.push('issueToken');
      return Promise.resolve('fresh-token');
    }),
  };
  const cookie = jest.fn();
  const res = { cookie } as unknown as Response;
  const controller = new AccountController(
    users as unknown as UsersService,
    auth as unknown as AuthService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    order.length = 0;
  });

  it('is session-scoped, with no company context', () => {
    expect(
      new Reflector().get<boolean>(IS_USER_SCOPED_KEY, AccountController),
    ).toBe(true);
  });

  it('changes the password, then re-issues the caller cookie so that session survives', async () => {
    const dto = { currentPassword: 'old-pass-1', newPassword: 'new-pass-2' };

    const result = await controller.changePassword(dto, 'user-1', res);

    expect(users.changePassword).toHaveBeenCalledWith(dto);
    expect(auth.issueToken).toHaveBeenCalledWith('user-1');
    // The token must be minted after the revocation marker is written.
    expect(order).toEqual(['changePassword', 'issueToken']);
    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'fresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({ message: 'Password changed' });
  });

  it('keeps the old cookie when the change is refused', async () => {
    users.changePassword.mockRejectedValueOnce(new Error('invalid_current_password'));

    await expect(
      controller.changePassword({ currentPassword: 'x', newPassword: 'y'.repeat(8) }, 'user-1', res),
    ).rejects.toThrow();
    expect(auth.issueToken).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
});
