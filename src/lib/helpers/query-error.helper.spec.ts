// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { QueryFailedError } from 'typeorm';

import { isDeadlockError, isDuplicateKeyError } from './query-error.helper';

/**
 * DB race helpers shared by the intake store and the message services: a
 * duplicate-key violation is a noop to report, a deadlock victim is safe to
 * retry. Both accept the wrapped (`QueryFailedError`) and raw driver shapes.
 */
describe('query-error.helper', () => {
  it('detects the MySQL duplicate-key code, wrapped or raw', () => {
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(
      isDuplicateKeyError(
        new QueryFailedError('INSERT', [], {
          code: 'ER_DUP_ENTRY',
        } as never),
      ),
    ).toBe(true);
    expect(
      isDuplicateKeyError(
        new QueryFailedError('INSERT', [], { errno: 1062 } as never),
      ),
    ).toBe(true);
  });

  it('detects the sqlite unique-constraint message', () => {
    const error = new QueryFailedError(
      'INSERT',
      [],
      new Error('UNIQUE constraint failed: messages.external_id') as never,
    );

    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it('ignores unrelated errors and deadlocks', () => {
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isDuplicateKeyError({ errno: 1213 })).toBe(false);
  });

  it('detects the InnoDB deadlock code, wrapped or raw', () => {
    expect(isDeadlockError({ code: 'ER_LOCK_DEADLOCK' })).toBe(true);
    expect(isDeadlockError({ errno: 1213 })).toBe(true);
    expect(
      isDeadlockError(
        new QueryFailedError('UPDATE', [], { errno: 1213 } as never),
      ),
    ).toBe(true);
    expect(isDeadlockError(new Error('boom'))).toBe(false);
    expect(isDeadlockError({ errno: 1062 })).toBe(false);
  });
});
