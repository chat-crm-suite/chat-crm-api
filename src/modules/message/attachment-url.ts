// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * T25: single source for the API-facing media URL.
 *
 * History, socket patches and message payloads must never expose a provider
 * link (or the raw private storage path). They reference our own
 * membership-checked attachments endpoint, keyed by the attachment id, so a
 * leaked URL only ever points at the authorized endpoint.
 */
export const ATTACHMENT_URL_PREFIX = '/attachments' as const;

/** `/attachments/:id` for a persisted attachment, or `null` without an id. */
export function buildAttachmentUrl(
  attachmentId?: string | null,
): string | null {
  if (!attachmentId) return null;

  return `${ATTACHMENT_URL_PREFIX}/${attachmentId}`;
}

/** Minimal shape needed to map an attachment to its media URL. */
export interface AttachmentUrlSource {
  id?: string | null;
  /** Present only once the file has been stored; absent while pending/failed. */
  storageUrl?: string | null;
}

/**
 * Our media URL for an attachment whose file exists, or `null` while it is
 * pending/failed. The URL is derived from the id, so a provider or storage
 * path can never leak even if one is present on the row.
 */
export function attachmentMediaUrl(
  attachment?: AttachmentUrlSource | null,
): string | null {
  if (!attachment?.storageUrl) return null;

  return buildAttachmentUrl(attachment.id);
}
