// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { PinoLogger } from 'nestjs-pino';

/**
 * Runs one best-effort Redis operation and never lets its failure bubble up:
 * the error is logged at `warn` and the caller's fallback is returned (a
 * read's safe default, or `undefined` for a write that is simply dropped).
 * Shared by the IA services so an unreachable Redis always degrades the same
 * way and never takes a request or an analysis down.
 */
export async function safely<T>(
  logger: PinoLogger,
  fallback: T,
  action: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await action();
  } catch (err: unknown) {
    logger.warn({ err }, message);
    return fallback;
  }
}
