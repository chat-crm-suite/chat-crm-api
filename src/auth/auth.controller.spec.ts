// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthUser } from '@auth';
import type { JwtPayload } from './auth.types';
import { IS_PUBLIC_KEY, IS_USER_SCOPED_KEY } from './decorators/access.decorators';
import { UsersService } from '../modules/users/users.service';
import { SessionRevocationService } from './session/session-revocation.service';

describe('AuthController', () => {
  let controller: AuthController;
  let res: jest.Mocked<Response>;

  const mockUser: AuthUser = {
    id: 'user-1',
    username: 'jeremi',
    firstName: 'Jeremi',
    lastName: null,
    avatarUrl: null,
    email: null,
    phoneNumber: null,
    isPlatformAdmin: false,
    memberships: [
      {
        id: 'member-1',
        companyId: 'company-1',
        companyName: 'J&P Perifericos',
        role: 'admin',
        status: 'active',
      },
    ],
  };

  const claims: JwtPayload = {
    sub: 'user-1',
    memberships: [{ cid: 'company-1', mid: 'member-1', role: 'admin' }],
    ts: 1,
  };

  const mocks = {
    authService: {
      sign: jest.fn(),
      refreshMemberships: jest.fn(),
    },
    users: {
      profile: jest.fn(),
    },
    sessions: {
      revoke: jest.fn().mockResolvedValue(undefined),
    },
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mocks.authService },
        { provide: UsersService, useValue: mocks.users },
        { provide: SessionRevocationService, useValue: mocks.sessions },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);

    res = {
      cookie: mocks.cookie,
      clearCookie: mocks.clearCookie,
    } as unknown as jest.Mocked<Response>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('route access', () => {
    const reflector = new Reflector();
    const meta = (handler: keyof AuthController, key: string) =>
      reflector.get<boolean>(key, AuthController.prototype[handler]);

    it('keeps login, logout and refresh public', () => {
      expect(meta('login', IS_PUBLIC_KEY)).toBe(true);
      expect(meta('logout', IS_PUBLIC_KEY)).toBe(true);
      expect(meta('refreshMemberships', IS_PUBLIC_KEY)).toBe(true);
    });

    it('serves the profile with a session but no company context', () => {
      expect(meta('getProfile', IS_PUBLIC_KEY)).toBeUndefined();
      expect(meta('getProfile', IS_USER_SCOPED_KEY)).toBe(true);
    });

    it('needs a session but no company to sign out everywhere', () => {
      expect(meta('revokeAll', IS_PUBLIC_KEY)).toBeUndefined();
      expect(meta('revokeAll', IS_USER_SCOPED_KEY)).toBe(true);
    });
  });

  describe('login', () => {
    it('should call AuthService.sign and set cookie', async () => {
      const dto: LoginDto = { username: 'jeremi', password: '1234' };

      mocks.authService.sign.mockResolvedValue('fake-token');

      const result = await controller.login(dto, res);

      expect(mocks.authService.sign).toHaveBeenCalledWith(dto);
      expect(mocks.cookie).toHaveBeenCalledWith(
        'access_token',
        'fake-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({
        message: 'Login Success',
      });
    });
  });

  describe('logout', () => {
    it('should clear cookie and return message', () => {
      const result = controller.logout(res);

      expect(mocks.clearCookie).toHaveBeenCalledWith('access_token');
      expect(result).toEqual({ message: 'Logout success' });
    });
  });

  describe('revokeAll', () => {
    it('revokes every session of the caller and clears the cookie', async () => {
      const result = await controller.revokeAll('user-1', res);

      expect(mocks.sessions.revoke).toHaveBeenCalledWith('user-1');
      expect(mocks.clearCookie).toHaveBeenCalledWith('access_token');
      expect(result).toEqual({ message: 'All sessions revoked' });
    });
  });

  describe('getProfile', () => {
    it('returns the profile with every membership for the client company list', async () => {
      mocks.users.profile.mockResolvedValue(mockUser);

      const result = await controller.getProfile(claims);

      expect(mocks.users.profile).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ user: mockUser });
    });

    it('rejects a session whose user no longer exists', async () => {
      mocks.users.profile.mockResolvedValue(null);

      await expect(controller.getProfile(claims)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshMemberships', () => {
    const req = { cookies: { access_token: 'stale-token' } } as unknown as Request;

    it('reissues the cookie from the current one and returns the fresh profile', async () => {
      mocks.authService.refreshMemberships.mockResolvedValue({
        token: 'fresh-token',
        userId: 'user-1',
      });
      mocks.users.profile.mockResolvedValue(mockUser);

      const result = await controller.refreshMemberships(req, res);

      expect(mocks.authService.refreshMemberships).toHaveBeenCalledWith('stale-token');
      expect(mocks.cookie).toHaveBeenCalledWith(
        'access_token',
        'fresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ user: mockUser });
    });

    it('does not set a cookie when the current token is rejected', async () => {
      mocks.authService.refreshMemberships.mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(controller.refreshMemberships(req, res)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mocks.cookie).not.toHaveBeenCalled();
    });
  });
});
