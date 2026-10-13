// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@modules/users/users.service';
import { CompanyMemberService } from '@modules/company-members/company-member.service';
import { UserFactory } from '@factories';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  const claims = [
    { cid: 'company-1', mid: 'member-1', role: 'admin' as const },
    { cid: 'company-2', mid: 'member-7', role: 'agent' as const },
  ];

  const mockUsersService = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockCompanyMembers = {
    findActiveClaims: jest.fn(),
  };

  // Factories do not assign ids; the token needs one.
  const userMock = UserFactory.build({ id: 'user-1' });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: CompanyMemberService, useValue: mockCompanyMembers },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    mockUsersService.findOne.mockResolvedValue(userMock);
    mockCompanyMembers.findActiveClaims.mockResolvedValue(claims);
    mockJwtService.signAsync.mockResolvedValue('jwt-token');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('valid()', () => {
    it('should return true if password matches hash', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.valid('123456', 'hashed');

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('123456', 'hashed');
    });

    it('should return false if password does not match', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.valid('123456', 'hashed');

      expect(result).toBe(false);
    });
  });

  describe('sign()', () => {
    const credentials = {
      username: 'jeremi',
      password: '123456',
    };

    it('issues a token with the identity and every active membership', async () => {
      mockUsersService.find.mockResolvedValue(userMock);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.sign(credentials);

      expect(result).toEqual('jwt-token');
      expect(mockUsersService.find).toHaveBeenCalledWith({ username: 'jeremi' });
      expect(mockCompanyMembers.findActiveClaims).toHaveBeenCalledWith(userMock.id);
      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: userMock.id,
        memberships: claims,
        ts: expect.any(Number) as number,
      });
    });

    it('should throw UnauthorizedException if user does not exist', async () => {
      mockUsersService.find.mockResolvedValue(null);

      await expect(service.sign(credentials)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockUsersService.find.mockResolvedValue(userMock);
      jest.spyOn(service, 'valid').mockResolvedValue(false);

      await expect(service.sign(credentials)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('issueToken()', () => {
    it('stamps the issue time in milliseconds', async () => {
      const before = Date.now();

      await service.issueToken(userMock.id);

      const [[payload]] = mockJwtService.signAsync.mock.calls as [[{ ts: number }]];
      expect(payload.ts).toBeGreaterThanOrEqual(before);
      expect(payload.ts).toBeLessThanOrEqual(Date.now());
    });

    it('refuses a deleted or unknown user', async () => {
      mockUsersService.findOne.mockResolvedValue(null);

      await expect(service.issueToken('gone')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('refreshMemberships()', () => {
    it('reissues a token from a verified one, reloading the memberships', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ sub: userMock.id });

      await expect(service.refreshMemberships('old-token')).resolves.toEqual({
        token: 'jwt-token',
        userId: userMock.id,
      });
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith('old-token');
      expect(mockCompanyMembers.findActiveClaims).toHaveBeenCalledWith(userMock.id);
    });

    it('rejects a missing token', async () => {
      await expect(service.refreshMemberships(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with an invalid signature or expiry', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refreshMemberships('bad')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
