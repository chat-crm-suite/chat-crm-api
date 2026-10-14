// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastValueFrom, of, throwError } from 'rxjs';

import { RemoveUploadedFileInterceptor } from './remove-uploaded-file.interceptor';

describe('RemoveUploadedFileInterceptor', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upload-cleanup-'));
    path = join(dir, 'incoming');
    writeFileSync(path, 'data');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const context = () =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ file: { path } }) }),
    }) as unknown as ExecutionContext;

  const waitForRemoval = async () => {
    for (let attempt = 0; attempt < 50 && existsSync(path); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('removes the temp file after a successful request', async () => {
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(new RemoveUploadedFileInterceptor().intercept(context(), next));
    await waitForRemoval();

    expect(existsSync(path)).toBe(false);
  });

  it('removes the temp file when validation or the handler fails', async () => {
    const next: CallHandler = { handle: () => throwError(() => new Error('refused')) };

    await expect(
      lastValueFrom(new RemoveUploadedFileInterceptor().intercept(context(), next)),
    ).rejects.toThrow('refused');
    await waitForRemoval();

    expect(existsSync(path)).toBe(false);
  });
});
