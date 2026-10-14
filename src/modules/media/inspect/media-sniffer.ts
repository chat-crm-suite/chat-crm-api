// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { normalizeMime } from '../../attachments/attachment-mime';

/** Bytes worth reading to identify a file (and a jpeg's dimensions). */
export const SNIFF_BYTES = 64 * 1024;

const OOXML_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const LEGACY_OFFICE_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

const TEXT_TYPES = new Set(['text/plain', 'text/csv']);

const ascii = (head: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...head.subarray(offset, offset + length));

const startsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => head[offset + index] === byte);

/**
 * The media type a file's content proves, from the declared type of the
 * upload and its first bytes. The browser-declared type alone is never
 * trusted: a renamed executable stays `null` and is refused. Containers that
 * hold several formats (zip-based Office, mp4, webm) use the declaration only
 * to pick between the formats the bytes allow.
 */
export function trustedMimeType(
  declared: string | null | undefined,
  head: Uint8Array,
): string | null {
  const claimed = normalizeMime(declared);

  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') {
    return 'image/gif';
  }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(head, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(head, 0, 6) === '#!AMR\n') return 'audio/amr';
  if (ascii(head, 0, 3) === 'ID3' || isMpegAudioFrame(head)) {
    return 'audio/mpeg';
  }
  if (isAdtsFrame(head)) return 'audio/aac';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return claimed.startsWith('audio/') ? 'audio/webm' : 'video/webm';
  }
  if (ascii(head, 4, 4) === 'ftyp') return isoMediaType(head, claimed);
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return OOXML_TYPES.has(claimed) ? claimed : null;
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return LEGACY_OFFICE_TYPES.has(claimed) ? claimed : null;
  }
  if (TEXT_TYPES.has(claimed) && isPlainText(head)) return claimed;

  return null;
}

/** ISO base media (mp4/3gp/mov): the major brand tells which. */
function isoMediaType(head: Uint8Array, claimed: string): string {
  const brand = ascii(head, 8, 4);

  if (brand.startsWith('3g')) return 'video/3gpp';
  if (brand === 'qt  ') return 'video/quicktime';
  if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
  // Generic brands (isom, mp42, iso5…) hold audio-only files too (Safari's
  // recorder): the declared kind decides.
  return claimed.startsWith('audio/') ? 'audio/mp4' : 'video/mp4';
}

/** MPEG-1/2 layer III frame sync without an ID3 tag. */
function isMpegAudioFrame(head: Uint8Array): boolean {
  return head[0] === 0xff && (head[1] & 0xe6) === 0xe2;
}

/** AAC ADTS frame sync (layer bits 00). */
function isAdtsFrame(head: Uint8Array): boolean {
  return head[0] === 0xff && (head[1] & 0xf6) === 0xf0;
}

/** Text has no magic: accept valid UTF-8 without NUL bytes. */
function isPlainText(head: Uint8Array): boolean {
  if (head.includes(0)) return false;

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(trimPartialUtf8(head));
    return true;
  } catch {
    return false;
  }
}

/** The head may cut a multi-byte character: drop an incomplete tail. */
function trimPartialUtf8(head: Uint8Array): Uint8Array {
  let end = head.length;
  let continuation = 0;

  while (end > 0 && continuation < 3 && (head[end - 1] & 0xc0) === 0x80) {
    end -= 1;
    continuation += 1;
  }
  if (end === 0) return head;

  const lead = head[end - 1];
  const expected =
    lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;

  return expected > continuation ? head.subarray(0, end - 1) : head;
}
