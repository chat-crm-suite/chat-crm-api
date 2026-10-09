// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ATTACHMENT_URL_PREFIX,
  attachmentMediaUrl,
  buildAttachmentUrl,
} from './attachment-url';

/**
 * T25: the media URL leaves our own endpoint, never a provider link or the
 * raw private storage path.
 */
describe('buildAttachmentUrl (T25)', () => {
  it('builds our own attachment endpoint URL from the attachment id', () => {
    expect(buildAttachmentUrl('att-1')).toBe('/attachments/att-1');
    expect(buildAttachmentUrl('att-1')).toContain(ATTACHMENT_URL_PREFIX);
  });

  it('never echoes a provider or storage path', () => {
    const url = buildAttachmentUrl('att-1');

    expect(url).not.toContain('http');
    expect(url).not.toContain('/uploads');
    expect(url).not.toContain('graph.facebook.com');
  });

  it('returns null without an id so no broken URL is emitted', () => {
    expect(buildAttachmentUrl(undefined)).toBeNull();
    expect(buildAttachmentUrl(null)).toBeNull();
    expect(buildAttachmentUrl('')).toBeNull();
  });

  it('maps a stored attachment to our URL regardless of its storage path', () => {
    expect(
      attachmentMediaUrl({
        id: 'att-1',
        storageUrl: 'https://graph.facebook.com/v22.0/media-1',
      }),
    ).toBe('/attachments/att-1');
  });

  it('returns null for a pending or failed attachment without a file', () => {
    expect(attachmentMediaUrl({ id: 'att-1', storageUrl: null })).toBeNull();
    expect(attachmentMediaUrl({ id: 'att-1' })).toBeNull();
    expect(attachmentMediaUrl(null)).toBeNull();
    expect(attachmentMediaUrl(undefined)).toBeNull();
  });
});
