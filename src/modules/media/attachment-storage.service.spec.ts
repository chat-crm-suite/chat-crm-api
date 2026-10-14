// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Writes go through the same company-scoped resolution as reads. */
describe('AttachmentStorageService writes', () => {
  let root: string;
  let storage: AttachmentStorageService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'storage-'));
    storage = new AttachmentStorageService(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const tempFile = (content: string) => {
    const path = join(root, `incoming-${Math.random()}`);
    writeFileSync(path, content);
    return path;
  };

  it('ingests a local file into the company folder and returns its storage URL', async () => {
    const source = tempFile('hello');

    const url = await storage.ingest('co-1', source, 'staged/a.txt');

    expect(url).toBe('/uploads/co-1/staged/a.txt');
    expect(readFileSync(join(root, 'co-1', 'staged', 'a.txt'), 'utf8')).toBe('hello');
    expect(existsSync(source)).toBe(false);
  });

  it('moves and removes stored files', async () => {
    const url = await storage.ingest('co-1', tempFile('x'), 'staged/b.txt');

    const moved = await storage.move('co-1', url, 'b.txt');
    expect(moved).toBe('/uploads/co-1/b.txt');
    expect(existsSync(join(root, 'co-1', 'staged', 'b.txt'))).toBe(false);

    await storage.remove('co-1', moved);
    expect(existsSync(join(root, 'co-1', 'b.txt'))).toBe(false);
  });

  it('refuses to write outside the company folder', async () => {
    await expect(
      storage.ingest('co-1', tempFile('x'), '../co-2/evil.txt'),
    ).rejects.toThrow();
  });

  it('sweeps only files older than the cutoff in the given folder', async () => {
    await storage.ingest('co-1', tempFile('old'), 'staged/old.txt');
    await storage.ingest('co-1', tempFile('new'), 'staged/new.txt');
    await storage.ingest('co-1', tempFile('kept'), 'kept.txt');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(root, 'co-1', 'staged', 'old.txt'), old, old);

    const removed = await storage.sweep('staged', new Date(Date.now() - 60 * 60 * 1000));

    expect(removed).toBe(1);
    expect(existsSync(join(root, 'co-1', 'staged', 'new.txt'))).toBe(true);
    expect(existsSync(join(root, 'co-1', 'kept.txt'))).toBe(true);
  });
});
