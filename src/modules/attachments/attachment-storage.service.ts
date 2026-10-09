// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { join, posix, resolve, sep } from 'node:path';

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
