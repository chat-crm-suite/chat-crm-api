// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { IaStateSchema, IaToggleSchema } from './ia.contract';

/**
 * T2: the admin toggle accepts `{ enabled: boolean }` and answers with the
 * resulting kill switch state.
 */
describe('IA kill switch contract (T2)', () => {
  it('accepts a boolean enabled flag', () => {
    expect(IaToggleSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(IaToggleSchema.parse({ enabled: true })).toEqual({ enabled: true });
  });

  it('rejects a missing or non-boolean flag', () => {
    expect(IaToggleSchema.safeParse({}).success).toBe(false);
    expect(IaToggleSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
    expect(IaToggleSchema.safeParse({ enabled: 1 }).success).toBe(false);
  });

  it('describes the resulting state as a boolean', () => {
    expect(IaStateSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(IaStateSchema.safeParse({ enabled: null }).success).toBe(false);
  });
});
