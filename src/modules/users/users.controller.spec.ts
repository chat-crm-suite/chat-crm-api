// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

/** Every `[METHOD path]` the controller answers. */
function routesOf(controller: typeof UsersController): string[] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = controller.prototype[name] as object;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      return method === undefined ? null : `${RequestMethod[method]} ${path}`;
    })
    .filter((route): route is string => route !== null)
    .sort();
}

describe('UsersController', () => {
  const service = {
    identify: jest.fn(),
    updateProfile: jest.fn(),
    saveAvatar: jest.fn(),
    findAvatar: jest.fn(),
  };
  const controller = new UsersController(service as unknown as UsersService);

  afterEach(() => jest.clearAllMocks());

  it('answers only the self-service routes: the open user CRUD is gone', () => {
    expect(routesOf(UsersController)).toEqual([
      'GET :id/avatar',
      'GET me',
      'PATCH me',
      'POST me/avatar',
    ]);
  });

  it('delegates the profile reads and writes to the service', async () => {
    service.identify.mockResolvedValue({ id: 'user-1' });
    service.updateProfile.mockResolvedValue({ id: 'user-1', firstName: 'Ana' });
    service.saveAvatar.mockResolvedValue({ avatarUrl: '/users/user-1/avatar?v=1' });
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;

    await expect(controller.me()).resolves.toEqual({ id: 'user-1' });
    await controller.updateMe({ firstName: 'Ana' });
    await expect(controller.uploadAvatar(file)).resolves.toEqual({
      avatarUrl: '/users/user-1/avatar?v=1',
    });

    expect(service.updateProfile).toHaveBeenCalledWith({ firstName: 'Ana' });
    expect(service.saveAvatar).toHaveBeenCalledWith(file);
  });

  describe('avatar()', () => {
    const response = () => {
      const res = new PassThrough() as PassThrough & { setHeader: jest.Mock };
      res.setHeader = jest.fn();
      return res;
    };

    it('answers 404 when the user has no avatar', async () => {
      service.findAvatar.mockResolvedValue(null);

      await expect(controller.avatar('user-1', response() as never)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('streams the file with a private one-day cache', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'avatar-ctrl-'));
      try {
        const path = join(dir, 'user-1.png');
        await writeFile(path, 'png-bytes');
        service.findAvatar.mockResolvedValue({ path, mime: 'image/png', size: 9 });
        const res = response();
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));

        await controller.avatar('user-1', res as never);
        await new Promise((resolve) => res.on('end', resolve));

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
        expect(res.setHeader).toHaveBeenCalledWith(
          'Cache-Control',
          'private, max-age=86400',
        );
        expect(Buffer.concat(chunks).toString()).toBe('png-bytes');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
