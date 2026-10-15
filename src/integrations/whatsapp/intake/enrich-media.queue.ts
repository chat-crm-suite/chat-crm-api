// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { JobsOptions } from 'bullmq';

import type { AttachmentType } from '@contracts';

/** T23: dedicated queue so heavy media never blocks webhook answers. */
export const ENRICH_MEDIA_QUEUE = 'enrich-media' as const;
export const ENRICH_MEDIA_JOB = 'enrich-media' as const;

/** Total attempts per job (1 initial run + 3 retries). */
export const ENRICH_MEDIA_ATTEMPTS = 4;
/** Base delay of the exponential backoff between attempts (2s, 4s, 8s). */
export const ENRICH_MEDIA_BACKOFF_DELAY_MS = 2_000;
/** Bounded concurrency so parallel downloads cannot exhaust sockets. */
export const ENRICH_MEDIA_CONCURRENCY = 5;
/** Per-attempt download timeout; the provider stream aborts past it. */
export const ENRICH_MEDIA_TIMEOUT_MS = 30_000;

const MiB = 1024 * 1024;

/**
 * Local guardrails bounding the streamed provider download, by attachment
 * type. These cap what we store, not what the provider accepts.
 */
export const ENRICH_MEDIA_MAX_BYTES_BY_TYPE: Record<AttachmentType, number> = {
  image: 16 * MiB,
  audio: 16 * MiB,
  video: 64 * MiB,
  document: 32 * MiB,
  sticker: 4 * MiB,
};

export const ENRICH_MEDIA_DEFAULT_MAX_BYTES = 16 * MiB;

/** What the event handler enqueues per saved message. */
export interface EnrichMediaJobData {
  messageId: string;
}

/** Where a job stands in its retry budget (BullMQ `attemptsMade` + `opts`). */
export interface EnrichMediaAttempt {
  attemptsMade: number;
  maxAttempts: number;
}

export function maxBytesForAttachmentType(type: string): number {
  return (
    (ENRICH_MEDIA_MAX_BYTES_BY_TYPE as Record<string, number>)[type] ??
    ENRICH_MEDIA_DEFAULT_MAX_BYTES
  );
}

export function enrichMediaJobOptions(): JobsOptions {
  return {
    attempts: ENRICH_MEDIA_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: ENRICH_MEDIA_BACKOFF_DELAY_MS,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

/** True once no BullMQ retry is left for this job. */
export function isLastAttempt(attempt: EnrichMediaAttempt): boolean {
  return attempt.attemptsMade + 1 >= attempt.maxAttempts;
}
