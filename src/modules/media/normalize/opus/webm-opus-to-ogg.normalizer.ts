// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { randomInt } from 'node:crypto';

import type {
  MediaFile,
  MediaNormalizer,
  NormalizedMedia,
} from '../media-normalizer';
import { writeOggOpus } from './ogg-opus-writer';
import { OPUS_SAMPLE_RATE } from './opus-packet';
import { readWebmOpus } from './webm-opus-reader';

/**
 * Chrome and Edge record voice notes as Opus in WebM, while WhatsApp (and
 * Telegram's `sendVoice`) want Opus in Ogg. Both hold the same Opus packets,
 * so this only swaps the container: no decoding, no quality loss, no ffmpeg.
 * The exact duration falls out of the packet headers for free.
 */
export class WebmOpusToOggNormalizer implements MediaNormalizer {
  constructor(private readonly serial: () => number = () => randomInt(2 ** 31)) {}

  supports(mimeType: string, accepted: readonly string[]): boolean {
    return mimeType === 'audio/webm' && accepted.includes('audio/ogg');
  }

  normalize(file: MediaFile): NormalizedMedia {
    const { head, packets } = readWebmOpus(file.data);
    const { data, totalSamples } = writeOggOpus({
      head,
      packets,
      serial: this.serial(),
    });
    const preSkip = Buffer.from(head).readUInt16LE(10);

    return {
      data,
      mimeType: 'audio/ogg',
      extension: 'ogg',
      durationMs: Math.max(
        Math.round(((totalSamples - preSkip) * 1000) / OPUS_SAMPLE_RATE),
        0,
      ),
    };
  }
}
