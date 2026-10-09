// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * T25 explicit mime allowlist: only media the product actually renders is
 * ever served from private storage. Anything else is rejected instead of
 * being streamed with an attacker-controlled content type.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  // Images (WhatsApp images + stickers).
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Audio.
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/opus',
  // Video.
  'video/mp4',
  'video/3gpp',
  'video/quicktime',
  'video/webm',
  // Documents.
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

/** Drops parameters (`; charset=…`) and lowercases, then checks the set. */
export function normalizeMime(mime?: string | null): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

export function isAllowedMime(mime?: string | null): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(normalizeMime(mime));
}
