// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { CsvParser } from 'nest-csv-parser';
import type { ClsService } from 'nestjs-cls';
import type { I18nService } from 'nestjs-i18n';
import type { PinoLogger } from 'nestjs-pino';
import type { Repository } from 'typeorm';

import type { SessionRevocationService } from '@auth/session/session-revocation.service';
import { CLS_USER_ID } from '../../config/cls.keys';
import type { User } from './entities/user.entity';
import type { UserRepository } from './user.repository';
import { UsersService } from './users.service';

function build(clsValues: Record<string, unknown> = {}) {
  const repo = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const userRepo = { findUserById: jest.fn() };
  const cls = { get: jest.fn((key: string) => clsValues[key]) };
  const sessions = { revoke: jest.fn().mockResolvedValue(undefined) };

  const service = new UsersService(
    repo as unknown as Repository<User>,
    userRepo as unknown as UserRepository,
    { setContext: jest.fn() } as unknown as PinoLogger,
    {} as CsvParser,
    cls as unknown as ClsService,
    {} as I18nService,
    sessions as unknown as SessionRevocationService,
  );

  return { service, repo, userRepo, cls, sessions };
}

describe('UsersService', () => {
  describe('identify()', () => {
    it('reads the session user from the shared CLS key', async () => {
      const { service, userRepo } = build({ [CLS_USER_ID]: 'user-1' });
      userRepo.findUserById.mockResolvedValue({ id: 'user-1' });

      await expect(service.identify()).resolves.toEqual({ id: 'user-1' });
      expect(userRepo.findUserById).toHaveBeenCalledWith('user-1');
    });

    it('returns null without a session user', async () => {
      const { service, userRepo } = build();

      await expect(service.identify()).resolves.toBeNull();
      expect(userRepo.findUserById).not.toHaveBeenCalled();
    });
  });

  describe('session revocation', () => {
    it('ends the user sessions when the password changes', async () => {
      const { service, sessions } = build();

      await service.update('user-1', { password: 'new-secret-1' });

      expect(sessions.revoke).toHaveBeenCalledWith('user-1');
    });

    it('keeps the sessions for a profile-only update', async () => {
      const { service, sessions } = build();

      await service.update('user-1', { firstName: 'Jeremi' });

      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('ends the user sessions when the user is deleted', async () => {
      const { service, repo, sessions } = build();

      await service.remove('user-1');

      expect(repo.softDelete).toHaveBeenCalledWith({ id: 'user-1' });
      expect(sessions.revoke).toHaveBeenCalledWith('user-1');
    });
  });
});
