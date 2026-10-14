// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable, Optional } from '@nestjs/common';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { ATTACHMENT_STORAGE_ROOT } from '../media/attachment-storage.service';
import { trustedMimeType } from '../media/inspect/media-sniffer';

/** Image types accepted as an avatar, with the extension stored for each. */
const AVATAR_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(AVATAR_TYPES).map(([mime, ext]) => [ext, mime]),
);

const USER_ID = /^[0-9a-f-]{36}$/i;

/** Mime of a profile picture from its first bytes, or `null` if it is not an allowed image. */
export function sniffAvatarMime(content: Uint8Array): string | null {
  // The declared type is deliberately ignored: only the bytes count.
  const mime = trustedMimeType(null, content.subarray(0, 64));

  return mime && mime in AVATAR_TYPES ? mime : null;
}

/**
 * Profile pictures live in `<storage root>/avatars/<userId>.<ext>`, beside the
 * company folders but outside any of them (an avatar belongs to the account,
 * not to a company) and served only through the session-checked
 * `GET /users/:id/avatar`. One file per user: saving replaces the previous one.
 */
@Injectable()
export class AvatarStorageService {
  private readonly dir: string;

  constructor(
    @Optional()
    @Inject(ATTACHMENT_STORAGE_ROOT)
    storageRoot?: string,
  ) {
    this.dir = join(resolve(storageRoot ?? join(process.cwd(), 'uploads')), 'avatars');
  }

  /** Stores the image (already sniffed as `mime`) and drops any older file of the user. */
  async save(userId: string, mime: string, content: Buffer): Promise<void> {
    const extension = AVATAR_TYPES[mime];
    if (!extension || !USER_ID.test(userId)) {
      throw new Error('Unsupported avatar type or user id');
    }

    await mkdir(this.dir, { recursive: true });

    const target = join(this.dir, `${userId}.${extension}`);
    const staging = `${target}.tmp`;
    await writeFile(staging, content);
    await rename(staging, target);

    await this.removeOthers(userId, extension);
  }

  /** Absolute path and mime of the user's avatar, or `null` when there is none. */
  async find(userId: string): Promise<{ path: string; mime: string; size: number } | null> {
    if (!USER_ID.test(userId)) return null;

    for (const [extension, mime] of Object.entries(MIME_BY_EXTENSION)) {
      const path = join(this.dir, `${userId}.${extension}`);
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) return { path, mime, size: info.size };
    }

    return null;
  }

  private async removeOthers(userId: string, keepExtension: string): Promise<void> {
    const files = await readdir(this.dir).catch(() => [] as string[]);

    await Promise.all(
      Object.values(AVATAR_TYPES)
        .filter((extension) => extension !== keepExtension)
        .map((extension) => `${userId}.${extension}`)
        .filter((name) => files.includes(name))
        .map((name) => rm(join(this.dir, name), { force: true })),
    );
  }
}
