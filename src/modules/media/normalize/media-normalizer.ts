// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Inject, Injectable } from '@nestjs/common';

/** A file about to be staged, in memory. */
export interface MediaFile {
  data: Buffer;
  mimeType: string;
}

/** The repackaged file plus what the conversion learned about it. */
export interface NormalizedMedia extends MediaFile {
  extension: string;
  durationMs: number | null;
}

/**
 * Converts a file the browser produces into one the channel accepts, e.g. a
 * Chrome voice recording (webm/opus) into the ogg/opus WhatsApp plays as a
 * voice note. Implementations are pure and dependency-free; a channel that
 * needs another container gets another normalizer, not a branch here.
 */
export interface MediaNormalizer {
  /** Whether this normalizer turns `mimeType` into one of `accepted`. */
  supports(mimeType: string, accepted: readonly string[]): boolean;
  normalize(file: MediaFile): NormalizedMedia;
}

export const MEDIA_NORMALIZERS = Symbol('MEDIA_NORMALIZERS');

/**
 * Applies the first normalizer that can make a file acceptable. Files the
 * channel already accepts are never touched.
 */
@Injectable()
export class MediaNormalizerChain {
  constructor(
    @Inject(MEDIA_NORMALIZERS)
    private readonly normalizers: readonly MediaNormalizer[],
  ) {}

  /** The normalizer for a file the channel cannot take as is, if any. */
  find(
    mimeType: string,
    accepted: readonly string[],
  ): MediaNormalizer | null {
    if (accepted.includes(mimeType)) return null;

    return (
      this.normalizers.find((normalizer) =>
        normalizer.supports(mimeType, accepted),
      ) ?? null
    );
  }
}
