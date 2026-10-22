// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { AttachmentType } from '@contracts';
import { AttachmentStorageService } from '../attachment-storage.service';

/** An upload not sent within this window is discarded. */
export const STAGED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Folder of every company storage that holds not-yet-sent uploads. */
export const STAGED_FOLDER = 'staged';

const stagedKey = (uploadId: string) => `upload:${uploadId}`;

/** Scope of a file attached to a message of one conversation. */
export const conversationUploadScope = (conversationId: string) =>
  `conversation:${conversationId}`;

/**
 * Scope of a template's header file: staged before the conversation exists
 * when the template starts one.
 */
export const templateUploadScope = (templateId: string) =>
  `template:${templateId}`;

/** What is known about a staged file (kept in the cache, never in MySQL). */
export interface StagedFile {
  uploadId: string;
  companyId: string;
  /** Where the file may be sent (`conversationUploadScope`, `templateUploadScope`). */
  scope: string;
  kind: AttachmentType;
  mimeType: string;
  sizeBytes: number;
  filename: string;
  extension: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Private storage URL: `staged/…` until consumed, final path after. */
  storageUrl: string;
  expiresAt: string;
  consumed: boolean;
}

export type StageInput = Omit<
  StagedFile,
  'uploadId' | 'storageUrl' | 'expiresAt' | 'consumed'
> & {
  /** Local file to move into storage (the upload, or its normalized copy). */
  sourcePath: string;
};

/**
 * Uploads live in two steps: staged (file in `<company>/staged/`, metadata in
 * the two-tier cache with a TTL) and consumed by the send that references
 * them (file moved next to the company's other attachments). No database row
 * exists until a message does, so abandoned uploads leave nothing behind but
 * a file the sweeper deletes.
 */
@Injectable()
export class StagedUploadStore {
  constructor(
    private readonly storage: AttachmentStorageService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async stage(input: StageInput, now = Date.now()): Promise<StagedFile> {
    const { sourcePath, ...meta } = input;
    const uploadId = randomUUID();
    const storageUrl = await this.storage.ingest(
      meta.companyId,
      sourcePath,
      `${STAGED_FOLDER}/${uploadId}.${meta.extension}`,
    );

    const staged: StagedFile = {
      ...meta,
      uploadId,
      storageUrl,
      expiresAt: new Date(now + STAGED_UPLOAD_TTL_MS).toISOString(),
      consumed: false,
    };
    await this.cache.set(stagedKey(uploadId), staged, STAGED_UPLOAD_TTL_MS);

    return staged;
  }

  /**
   * The staged file if it is still usable in `scope`, without consuming it:
   * lets a send be refused before its row exists.
   */
  async find(
    uploadId: string,
    scope: Pick<StagedFile, 'companyId' | 'scope' | 'kind'>,
  ): Promise<StagedFile | null> {
    const staged = await this.cache.get<StagedFile>(stagedKey(uploadId));
    return staged && matchesScope(staged, scope) ? staged : null;
  }

  /**
   * Hands a staged file to the send that references it. The scope must match
   * where it was uploaded (company, scope and kind), so an upload can
   * never be sent elsewhere. Idempotent: a retried send gets the same file.
   */
  async consume(
    uploadId: string,
    scope: Pick<StagedFile, 'companyId' | 'scope' | 'kind'>,
  ): Promise<StagedFile> {
    const staged = await this.cache.get<StagedFile>(stagedKey(uploadId));

    if (!staged || !matchesScope(staged, scope)) {
      throw new NotFoundException('Upload not found or expired');
    }
    if (staged.consumed) return staged;

    const storageUrl = await this.storage.move(
      staged.companyId,
      staged.storageUrl,
      `${uploadId}.${staged.extension}`,
    );
    const consumed: StagedFile = { ...staged, storageUrl, consumed: true };
    const ttl = Math.max(Date.parse(staged.expiresAt) - Date.now(), 1);
    await this.cache.set(stagedKey(uploadId), consumed, ttl);

    return consumed;
  }

  /** Deletes staged files older than the TTL (their metadata already expired). */
  sweep(now = Date.now()): Promise<number> {
    return this.storage.sweep(
      STAGED_FOLDER,
      new Date(now - STAGED_UPLOAD_TTL_MS),
    );
  }
}

function matchesScope(
  staged: StagedFile,
  scope: Pick<StagedFile, 'companyId' | 'scope' | 'kind'>,
): boolean {
  return (
    staged.companyId === scope.companyId &&
    staged.scope === scope.scope &&
    staged.kind === scope.kind
  );
}
