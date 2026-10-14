// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import * as bcrypt from 'bcrypt';
import type { ClsService } from 'nestjs-cls';
import type { I18nService } from 'nestjs-i18n';
import type { PinoLogger } from 'nestjs-pino';
import type { Repository } from 'typeorm';

import type { SessionRevocationService } from '@auth/session/session-revocation.service';
import { AVATAR_MAX_BYTES } from '../../contracts/index';
import { CLS_USER_ID } from '../../config/cls.keys';
import type { AvatarStorageService } from './avatar-storage.service';
import type { User } from './entities/user.entity';
import type { UserRepository } from './user.repository';
import { UsersService } from './users.service';

const USER_ID = '0192a000-0000-7000-8000-000000000001';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const GIF = Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1');

function build(clsValues: Record<string, unknown> = { [CLS_USER_ID]: USER_ID }) {
  const repo = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const userRepo = { findUserById: jest.fn().mockResolvedValue({ id: USER_ID }) };
  const cls = { get: jest.fn((key: string) => clsValues[key]) };
  const sessions = { revoke: jest.fn().mockResolvedValue(undefined) };
  const avatars = {
    save: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(null),
  };

  const service = new UsersService(
    repo as unknown as Repository<User>,
    userRepo as unknown as UserRepository,
    { setContext: jest.fn() } as unknown as PinoLogger,
    cls as unknown as ClsService,
    {} as I18nService,
    sessions as unknown as SessionRevocationService,
    avatars as unknown as AvatarStorageService,
  );

  return { service, repo, userRepo, cls, sessions, avatars };
}

describe('UsersService', () => {
  describe('identify()', () => {
    it('reads the session user from the shared CLS key', async () => {
      const { service, userRepo } = build();
      userRepo.findUserById.mockResolvedValue({ id: USER_ID });

      await expect(service.identify()).resolves.toEqual({ id: USER_ID });
      expect(userRepo.findUserById).toHaveBeenCalledWith(USER_ID);
    });

    it('returns null without a session user', async () => {
      const { service, userRepo } = build({});

      await expect(service.identify()).resolves.toBeNull();
      expect(userRepo.findUserById).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile()', () => {
    it('writes only the profile fields it was given, with the email lowercased', async () => {
      const { service, repo } = build();

      await service.updateProfile({ firstName: 'Ana', email: 'ANA@Acme.test' });

      expect(repo.update).toHaveBeenCalledWith(USER_ID, {
        firstName: 'Ana',
        email: 'ana@acme.test',
      });
    });

    it('never writes username, password or the platform flag, even if smuggled in', async () => {
      const { service, repo } = build();

      await service.updateProfile({
        lastName: 'Lopez',
        username: 'root',
        passwordHash: 'x',
        isPlatformAdmin: true,
      } as never);

      expect(repo.update).toHaveBeenCalledWith(USER_ID, { lastName: 'Lopez' });
    });

    it('clears a name or phone sent empty', async () => {
      const { service, repo } = build();

      await service.updateProfile({ firstName: '', phoneNumber: '' });

      expect(repo.update).toHaveBeenCalledWith(USER_ID, {
        firstName: null,
        phoneNumber: null,
      });
    });

    it('answers 409 when the email belongs to another account', async () => {
      const { service, repo } = build();
      repo.findOne.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.updateProfile({ email: 'taken@acme.test' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'email_taken' },
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('answers 409 when the phone belongs to another account', async () => {
      const { service, repo } = build();
      repo.findOne.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.updateProfile({ phoneNumber: '+51999000111' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'phone_taken' },
      });
    });

    it('does not treat the user own email or phone as a conflict', async () => {
      const { service, repo } = build();
      repo.findOne.mockResolvedValue({ id: USER_ID });

      await service.updateProfile({ email: 'me@acme.test' });

      expect(repo.update).toHaveBeenCalledWith(USER_ID, { email: 'me@acme.test' });
    });

    it('maps a unique violation raced past the check to 409', async () => {
      const { service, repo } = build();
      repo.update.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));

      await expect(
        service.updateProfile({ email: 'race@acme.test' }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'contact_taken' } });
    });

    it('rejects a request without a session user', async () => {
      const { service } = build({});

      await expect(service.updateProfile({ firstName: 'Ana' })).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('changePassword()', () => {
    const withPassword = async (current: string) => {
      const built = build();
      built.repo.findOne.mockResolvedValue({
        id: USER_ID,
        passwordHash: await bcrypt.hash(current, 4),
      });
      return built;
    };

    it('refuses a wrong current password without touching anything', async () => {
      const { service, repo, sessions } = await withPassword('right-pass-1');

      await expect(
        service.changePassword({ currentPassword: 'wrong', newPassword: 'brand-new-2' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'invalid_current_password' },
      });
      expect(repo.update).not.toHaveBeenCalled();
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('refuses to reuse the current password', async () => {
      const { service, repo } = await withPassword('right-pass-1');

      await expect(
        service.changePassword({ currentPassword: 'right-pass-1', newPassword: 'right-pass-1' }),
      ).rejects.toMatchObject({ response: { code: 'password_unchanged' } });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('stores a cost-10 hash of the new password, then revokes the sessions', async () => {
      const { service, repo, sessions } = await withPassword('right-pass-1');
      const order: string[] = [];
      repo.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ affected: 1 });
      });
      sessions.revoke.mockImplementation(() => {
        order.push('revoke');
        return Promise.resolve();
      });

      await service.changePassword({
        currentPassword: 'right-pass-1',
        newPassword: 'brand-new-2',
      });

      const [id, patch] = repo.update.mock.calls[0] as [string, { passwordHash: string }];
      expect(id).toBe(USER_ID);
      expect(bcrypt.getRounds(patch.passwordHash)).toBe(10);
      await expect(bcrypt.compare('brand-new-2', patch.passwordHash)).resolves.toBe(true);
      expect(sessions.revoke).toHaveBeenCalledWith(USER_ID);
      expect(order).toEqual(['update', 'revoke']);
    });
  });

  describe('saveAvatar()', () => {
    const upload = (buffer: Buffer) => ({ buffer, size: buffer.length });

    it('stores a jpeg, png or webp sniffed from its bytes and sets the versioned url', async () => {
      for (const [bytes, mime] of [
        [JPEG, 'image/jpeg'],
        [PNG, 'image/png'],
        [WEBP, 'image/webp'],
      ] as const) {
        const { service, repo, avatars } = build();

        const result = await service.saveAvatar(upload(bytes));

        expect(avatars.save).toHaveBeenCalledWith(USER_ID, mime, bytes);
        expect(result.avatarUrl).toMatch(
          new RegExp(`^/users/${USER_ID}/avatar\\?v=\\d+$`),
        );
        expect(repo.update).toHaveBeenCalledWith(USER_ID, {
          avatarUrl: result.avatarUrl,
        });
      }
    });

    it('ignores the client mime: a renamed non-image is refused with 415', async () => {
      const { service, avatars } = build();
      const exe = Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000', 'latin1');

      await expect(
        service.saveAvatar({ ...upload(exe), mimetype: 'image/png' } as never),
      ).rejects.toMatchObject({ status: 415 });
      expect(avatars.save).not.toHaveBeenCalled();
    });

    it('refuses an image type outside the allowlist (gif, svg)', async () => {
      const { service } = build();

      await expect(service.saveAvatar(upload(GIF))).rejects.toMatchObject({ status: 415 });
      await expect(
        service.saveAvatar(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
      ).rejects.toMatchObject({ status: 415 });
    });

    it('refuses an upload over the size limit with 413', async () => {
      const { service, avatars } = build();
      const big = Buffer.concat([JPEG, Buffer.alloc(AVATAR_MAX_BYTES)]);

      await expect(service.saveAvatar(upload(big))).rejects.toMatchObject({ status: 413 });
      expect(avatars.save).not.toHaveBeenCalled();
    });

    it('accepts a file of exactly the limit', async () => {
      const { service, avatars } = build();
      const max = Buffer.concat([JPEG, Buffer.alloc(AVATAR_MAX_BYTES - JPEG.length)]);

      await service.saveAvatar(upload(max));

      expect(avatars.save).toHaveBeenCalled();
    });

    it('requires a file', async () => {
      const { service } = build();

      await expect(service.saveAvatar(undefined)).rejects.toMatchObject({ status: 400 });
      await expect(service.saveAvatar(upload(Buffer.alloc(0)))).rejects.toMatchObject({
        status: 400,
      });
    });
  });
});
