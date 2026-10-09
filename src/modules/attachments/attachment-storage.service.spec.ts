// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { join } from 'node:path';

import { AttachmentStorageService } from './attachment-storage.service';

/**
 * T25: media lives in company-scoped private storage; resolution must refuse
 * anything that leaves the owning company folder (a foreign company path or a
 * traversal escape). Cross-company isolation is enforced here even before the
 * membership check in the endpoint.
 */
describe('AttachmentStorageService (T25)', () => {
  const root = join('C:', 'private-uploads');
  const storage = new AttachmentStorageService(root);

  it('resolves a company-scoped storage path under the private root', () => {
    expect(storage.resolve('co-1', '/uploads/co-1/media-1.jpg')).toBe(
      join(root, 'co-1', 'media-1.jpg'),
    );
  });

  it('rejects another company storage path even from a valid session', () => {
    expect(() => storage.resolve('co-1', '/uploads/co-2/media-1.jpg')).toThrow(
      /outside the company storage/,
    );
  });

  it('rejects a traversal escape out of the company folder', () => {
    expect(() =>
      storage.resolve('co-1', '/uploads/co-1/../../co-2/secret.jpg'),
    ).toThrow(/escapes storage|outside the company storage/);
  });

  it('rejects a provider or public URL instead of the private prefix', () => {
    expect(() =>
      storage.resolve('co-1', 'https://graph.facebook.com/media-1'),
    ).toThrow(/not in private storage/);
  });

  it('rejects an empty company context or a bare company folder', () => {
    expect(() => storage.resolve('', '/uploads/co-1/a.jpg')).toThrow(
      /Company context required/,
    );
    expect(() => storage.resolve('co-1', '/uploads/co-1/')).toThrow(
      /outside the company storage/,
    );
    expect(() => storage.resolve('co-1', undefined)).toThrow(
      /not in private storage/,
    );
  });
});
