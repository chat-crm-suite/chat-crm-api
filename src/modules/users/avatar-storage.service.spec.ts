// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AvatarStorageService, sniffAvatarMime } from './avatar-storage.service';

const USER_ID = '0192a000-0000-7000-8000-000000000001';

describe('AvatarStorageService', () => {
  let root: string;
  let storage: AvatarStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'avatars-'));
    storage = new AvatarStorageService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores one file per user under avatars/ and finds it', async () => {
    expect(await storage.find(USER_ID)).toBeNull();

    await storage.save(USER_ID, 'image/png', Buffer.from('png'));

    const found = await storage.find(USER_ID);
    expect(found).toMatchObject({
      path: join(root, 'avatars', `${USER_ID}.png`),
      mime: 'image/png',
      size: 3,
    });
  });

  it('replaces the previous file even when the image type changes', async () => {
    await storage.save(USER_ID, 'image/png', Buffer.from('old'));
    await storage.save(USER_ID, 'image/webp', Buffer.from('newer'));

    expect(await readdir(join(root, 'avatars'))).toEqual([`${USER_ID}.webp`]);
    expect((await storage.find(USER_ID))?.mime).toBe('image/webp');
  });

  it('refuses ids that could escape the folder', async () => {
    expect(await storage.find('../../etc/passwd')).toBeNull();
    await expect(
      storage.save('../evil', 'image/png', Buffer.from('x')),
    ).rejects.toThrow();
  });

  it('refuses a type outside the allowlist', async () => {
    await expect(
      storage.save(USER_ID, 'image/gif', Buffer.from('x')),
    ).rejects.toThrow();
  });
});

describe('sniffAvatarMime', () => {
  it('reads the type from the first bytes only', () => {
    expect(sniffAvatarMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(
      sniffAvatarMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(sniffAvatarMime(Buffer.from('plain text'))).toBeNull();
    expect(sniffAvatarMime(Buffer.from('GIF89a....'))).toBeNull();
  });
});
