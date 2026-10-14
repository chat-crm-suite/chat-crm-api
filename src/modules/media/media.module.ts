// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from '@nestjs/common';

import { AttachmentStorageService } from './attachment-storage.service';
import {
  MEDIA_NORMALIZERS,
  MediaNormalizerChain,
  type MediaNormalizer,
} from './normalize/media-normalizer';
import { WebmOpusToOggNormalizer } from './normalize/opus/webm-opus-to-ogg.normalizer';
import { StagedUploadStore } from './staging/staged-upload.store';
import { StagedUploadSweeper } from './staging/staged-upload.sweeper';

/** Normalizers available to every channel (see `MediaNormalizer`). */
const normalizers: MediaNormalizer[] = [new WebmOpusToOggNormalizer()];

/**
 * Media files: private company storage, staged uploads and the
 * format normalizers. Depends on nothing domain-specific, so conversations
 * (uploads, sends) and attachments (delivery) both build on it.
 */
@Module({
  providers: [
    AttachmentStorageService,
    StagedUploadStore,
    StagedUploadSweeper,
    MediaNormalizerChain,
    { provide: MEDIA_NORMALIZERS, useValue: normalizers },
  ],
  exports: [AttachmentStorageService, StagedUploadStore, MediaNormalizerChain],
})
export class MediaModule {}
