// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { ContractsController } from './contracts.controller';

describe('ContractsController', () => {
  const controller = new ContractsController();

  it('version exposes the fingerprint but not the per-file detail', () => {
    const version = controller.version() as Record<string, unknown>;

    expect(version).toHaveProperty('tag');
    expect(version).toHaveProperty('commit');
    expect(version).toHaveProperty('hash');
    expect(version).toHaveProperty('generatedAt');
    expect(version).not.toHaveProperty('files');
  });

  it('manifest exposes the per-file detail', () => {
    const manifest = controller.manifest() as Record<string, unknown>;

    expect(manifest).toHaveProperty('hash');
    expect(typeof manifest.files).toBe('object');
    expect(Object.keys(manifest.files as object).length).toBeGreaterThan(0);
  });

  it('snapshot exposes every contract grouped by name', () => {
    const snapshot = controller.snapshot() as {
      contracts: Record<string, unknown>;
    };

    expect(snapshot.contracts).toHaveProperty('user');
    expect(snapshot.contracts).toHaveProperty('socket');
  });
});
