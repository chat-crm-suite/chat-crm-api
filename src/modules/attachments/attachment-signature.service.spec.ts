// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ATTACHMENT_SIGNED_TTL_MS,
  AttachmentSignatureService,
} from './attachment-signature.service';

/**
 * T25 short-lived signed exposure: a signature is valid for one attachment id
 * and a short window, so a leaked or stale URL is unusable. Only the
 * signed direct-from-storage path uses it.
 */
describe('AttachmentSignatureService (T25)', () => {
  const now = 1_700_000_000_000;
  const signatures = new AttachmentSignatureService('test-secret');

  it('verifies a freshly signed grant', () => {
    const grant = signatures.sign('att-1', ATTACHMENT_SIGNED_TTL_MS, now);

    expect(signatures.verify('att-1', grant, now + 1_000)).toBe(true);
  });

  it('rejects an expired grant (stale URL)', () => {
    const grant = signatures.sign('att-1', 1_000, now);

    expect(signatures.verify('att-1', grant, now + 1_001)).toBe(false);
    expect(signatures.verify('att-1', grant, now + 60_000)).toBe(false);
  });

  it('rejects a tampered signature or a grant for another attachment', () => {
    const grant = signatures.sign('att-1', ATTACHMENT_SIGNED_TTL_MS, now);

    expect(signatures.verify('att-2', grant, now + 1_000)).toBe(false);
    expect(
      signatures.verify('att-1', { ...grant, sig: 'deadbeef' }, now + 1_000),
    ).toBe(false);
    expect(
      signatures.verify('att-1', { ...grant, expires: grant.expires + 1 }, now),
    ).toBe(false);
  });

  it('rejects malformed grants instead of throwing', () => {
    expect(signatures.verify('att-1', { expires: 'soon', sig: 'x' }, now)).toBe(
      false,
    );
    expect(signatures.verify('att-1', { expires: now + 1, sig: '' }, now)).toBe(
      false,
    );
  });

  it('builds a signed direct-from-storage URL under our own endpoint', () => {
    const url = signatures.buildSignedUrl('att-1', 1_000, now);

    expect(url).toBe(
      `/attachments/att-1/signed?expires=${now + 1_000}&sig=${signatures.sign('att-1', 1_000, now).sig}`,
    );
    expect(url).not.toContain('http');
  });
});
