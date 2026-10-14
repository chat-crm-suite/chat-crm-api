// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';

/** Storage root override, mainly for tests and non-default deployments. */
export const ATTACHMENT_STORAGE_ROOT = 'ATTACHMENT_STORAGE_ROOT';

/** Private media path prefix written by the WhatsApp client on download. */
export const PRIVATE_STORAGE_PREFIX = '/uploads/' as const;

/**
 * T25 private, company-scoped storage resolver.
 *
 * Stored media lives under `<root>/<companyId>/<file>` and, unlike the public
 * `ServeStatic` `/uploads` mount, is only reachable through the
 * membership-checked attachments endpoint. Resolution refuses any path that
 * is not inside the owning company folder: a valid session for company A can
 * never read company B's file, and `..` cannot escape the folder.
 */
@Injectable()
export class AttachmentStorageService {
  private readonly root: string;

  constructor(
    @Optional()
    @Inject(ATTACHMENT_STORAGE_ROOT)
    storageRoot?: string,
  ) {
    this.root = resolve(storageRoot ?? join(process.cwd(), 'uploads'));
  }

  /**
   * Moves a local file (a finished upload, a normalized output) into the
   * company's storage at `relativePath` and returns its private storage URL.
   * Works across devices (temp dir on another volume) by copying.
   */
  async ingest(
    companyId: string,
    sourcePath: string,
    relativePath: string,
  ): Promise<string> {
    const storageUrl = this.toStorageUrl(companyId, relativePath);
    const target = this.resolve(companyId, storageUrl);

    await mkdir(dirname(target), { recursive: true });
    await moveFile(sourcePath, target);

    return storageUrl;
  }

  /** Moves a stored file to another path of the same company storage. */
  async move(
    companyId: string,
    storageUrl: string,
    relativePath: string,
  ): Promise<string> {
    return this.ingest(companyId, this.resolve(companyId, storageUrl), relativePath);
  }

  /** Deletes a stored file; a missing file is not an error. */
  async remove(companyId: string, storageUrl: string): Promise<void> {
    await rm(this.resolve(companyId, storageUrl), { force: true });
  }

  /**
   * Deletes files under every company's `folder` last modified before
   * `olderThan`, returning how many were removed (e.g. abandoned uploads).
   */
  async sweep(folder: string, olderThan: Date): Promise<number> {
    let removed = 0;
    const companies = await readdir(this.root, { withFileTypes: true }).catch(
      () => [],
    );

    for (const company of companies) {
      if (!company.isDirectory()) continue;

      const dir = join(this.root, company.name, folder);
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        const path = join(dir, file);
        const info = await stat(path).catch(() => null);
        if (!info?.isFile() || info.mtime >= olderThan) continue;

        await rm(path, { force: true });
        removed += 1;
      }
    }

    return removed;
  }

  /** Absolute path of a stored file, guaranteed to be inside `companyId`. */
  resolve(companyId: string, storageUrl?: string | null): string {
    const relative = this.toCompanyRelativePath(companyId, storageUrl);
    const companyRoot = resolve(this.root, companyId);
    const absolutePath = resolve(this.root, relative);

    if (
      absolutePath !== companyRoot &&
      !absolutePath.startsWith(companyRoot + sep)
    ) {
      throw new ForbiddenException('Attachment is outside the company storage');
    }

    return absolutePath;
  }

  private toStorageUrl(companyId: string, relativePath: string): string {
    return `${PRIVATE_STORAGE_PREFIX}${companyId}/${relativePath}`;
  }

  /** `<companyId>/<file>` for a private storage URL, or a ForbiddenException. */
  private toCompanyRelativePath(
    companyId: string,
    storageUrl?: string | null,
  ): string {
    if (!companyId) {
      throw new ForbiddenException('Company context required');
    }
    if (
      typeof storageUrl !== 'string' ||
      !storageUrl.startsWith(PRIVATE_STORAGE_PREFIX)
    ) {
      throw new ForbiddenException('Attachment is not in private storage');
    }

    const normalized = posix.normalize(
      storageUrl.slice(PRIVATE_STORAGE_PREFIX.length),
    );
    if (normalized.startsWith('..') || posix.isAbsolute(normalized)) {
      throw new ForbiddenException('Attachment path escapes storage');
    }

    const [owner, ...rest] = normalized.split('/');
    if (
      owner !== companyId ||
      rest.length === 0 ||
      rest.some((part) => !part)
    ) {
      throw new ForbiddenException('Attachment is outside the company storage');
    }

    return normalized;
  }
}

/** `rename`, falling back to copy + delete across devices (EXDEV). */
async function moveFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;

    await copyFile(source, target);
    await rm(source, { force: true });
  }
}
