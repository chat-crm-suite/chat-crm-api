// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { z } from 'zod';

import {
  buildSnapshot,
  canonicalize,
  serializeSnapshot,
  toContractPayload,
} from './contracts-snapshot';

describe('contracts snapshot builders', () => {
  describe('canonicalize', () => {
    it('sorts object keys recursively', () => {
      expect(canonicalize({ b: 1, a: { d: 1, c: 2 } })).toEqual({
        a: { c: 2, d: 1 },
        b: 1,
      });
    });

    it('sorts the `required` array of a JSON schema', () => {
      const result = canonicalize({
        type: 'object',
        required: ['b', 'a'],
      }) as Record<string, unknown>;

      expect(result.required).toEqual(['a', 'b']);
    });

    it('keeps array order for non-`required` arrays (e.g. enums)', () => {
      expect(canonicalize({ enum: ['b', 'a'] })).toEqual({ enum: ['b', 'a'] });
    });
  });

  describe('toContractPayload', () => {
    it('serializes a Zod schema to JSON Schema', () => {
      const payload = toContractPayload(z.object({ name: z.string() }));

      expect(payload.kind).toBe('schema');
    });

    it('does not throw on unrepresentable types (coerce/preprocess)', () => {
      const payload = toContractPayload(
        z.object({ when: z.coerce.date(), n: z.coerce.number() }),
      );

      expect(payload.kind).toBe('schema');
    });

    it('marks functions (schema factories) without a body', () => {
      expect(toContractPayload(() => undefined)).toEqual({ kind: 'factory' });
    });

    it('keeps plain constants as values', () => {
      expect(toContractPayload({ conversation: 'conversation' })).toEqual({
        kind: 'value',
        value: { conversation: 'conversation' },
      });
    });
  });

  describe('buildSnapshot determinism', () => {
    it('groups exports by contract name', () => {
      const snapshot = buildSnapshot({
        user: { UserSchema: z.object({ id: z.string() }) },
        auth: { LoginSchema: z.object({ username: z.string() }) },
      });

      expect(Object.keys(snapshot.contracts)).toEqual(['auth', 'user']);
      expect(Object.keys(snapshot.contracts.user)).toEqual(['UserSchema']);
    });

    it('is stable when z.object fields are reordered', () => {
      const a = buildSnapshot({
        x: { S: z.object({ a: z.string(), b: z.number() }) },
      });
      const b = buildSnapshot({
        x: { S: z.object({ b: z.number(), a: z.string() }) },
      });

      expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
    });

    it('changes when a field is renamed', () => {
      const before = buildSnapshot({
        x: { S: z.object({ username: z.string() }) },
      });
      const after = buildSnapshot({
        x: { S: z.object({ userName: z.string() }) },
      });

      expect(serializeSnapshot(before)).not.toBe(serializeSnapshot(after));
    });

    it('serializes with a trailing newline', () => {
      const text = serializeSnapshot({ contracts: {} });

      expect(text.endsWith('\n')).toBe(true);
    });
  });
});
