// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getJwtSecret } from '../../auth/jwt.config';
import { ATTACHMENT_URL_PREFIX } from '../message/attachment-url';

/** Default short life of a direct-from-storage exposure. */
export const ATTACHMENT_SIGNED_TTL_MS = 5 * 60 * 1000;

export const ATTACHMENT_URL_SECRET = 'ATTACHMENT_URL_SECRET';

export interface AttachmentGrant {
  expires: string | number;
  sig: string;
}

export function getAttachmentSecret(): string {
  return process.env[ATTACHMENT_URL_SECRET] || getJwtSecret();
}

/**
 * T25 short-lived signed exposure.
 *
 * Media is normally streamed through the membership-checked endpoint; a
 * signature is only produced when a URL is served straight from storage, and
 * it is bound to one attachment id plus a short expiry. A leaked or stale
 * signed URL becomes unusable once `expires` is in the past, and a tampered
 * signature never verifies.
 */
export class AttachmentSignatureService {
  private readonly secret: string;

  constructor(secret: string = getAttachmentSecret()) {
    this.secret = secret;
  }

  sign(
    attachmentId: string,
    ttlMs: number = ATTACHMENT_SIGNED_TTL_MS,
    now: number = Date.now(),
  ): { expires: number; sig: string } {
    const expires = now + ttlMs;

    return { expires, sig: this.digest(attachmentId, expires) };
  }

  verify(
    attachmentId: string,
    grant: AttachmentGrant,
    now: number = Date.now(),
  ): boolean {
    const expires = Number(grant?.expires);
    if (!Number.isInteger(expires) || expires <= now) return false;
    if (typeof grant?.sig !== 'string' || !grant.sig) return false;

    return this.safeEqual(this.digest(attachmentId, expires), grant.sig);
  }

  /** Signed direct-from-storage path, or `null` without a concrete id. */
  buildSignedUrl(
    attachmentId: string,
    ttlMs: number = ATTACHMENT_SIGNED_TTL_MS,
    now: number = Date.now(),
  ): string | null {
    if (!attachmentId) return null;

    const { expires, sig } = this.sign(attachmentId, ttlMs, now);

    return `${ATTACHMENT_URL_PREFIX}/${attachmentId}/signed?expires=${expires}&sig=${sig}`;
  }

  private digest(attachmentId: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${attachmentId}.${expires}`)
      .digest('hex');
  }

  private safeEqual(expected: string, received: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }
}
