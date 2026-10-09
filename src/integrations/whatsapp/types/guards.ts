// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Runtime guards shared by the inbound parsing surface (ticket #26 review):
 * the strict parsers and the publishing border must agree on what counts as
 * a record and as a usable string, so the check lives in one place.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
