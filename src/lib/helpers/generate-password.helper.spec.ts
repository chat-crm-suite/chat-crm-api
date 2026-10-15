// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { generateInitialPassword } from './generate-password.helper';

describe('generateInitialPassword', () => {
  it('always mixes upper, lower and digit and avoids ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateInitialPassword();

      expect(password).toHaveLength(14);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it('never goes below 8 characters', () => {
    expect(generateInitialPassword(3)).toHaveLength(8);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateInitialPassword()));

    expect(seen.size).toBe(100);
  });
});
