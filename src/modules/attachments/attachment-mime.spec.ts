// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { isAllowedMime, normalizeMime } from './attachment-mime';

/**
 * T25: only an explicit allowlist of mime types is served from private
 * storage; parameters are ignored and casing does not matter.
 */
describe('attachment mime allowlist (T25)', () => {
  it.each([
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/ogg',
    'video/mp4',
    'application/pdf',
    'text/plain',
  ])('allows %s', (mime) => {
    expect(isAllowedMime(mime)).toBe(true);
  });

  it.each([
    'application/x-httpd-php',
    'text/html',
    'application/javascript',
    'image/svg+xml',
    'application/octet-stream',
    '',
    undefined,
    null,
  ])('rejects %s', (mime) => {
    expect(isAllowedMime(mime)).toBe(false);
  });

  it('ignores parameters and casing', () => {
    expect(isAllowedMime('IMAGE/JPEG; charset=binary')).toBe(true);
    expect(normalizeMime('Image/Png ; foo=bar')).toBe('image/png');
  });
});
