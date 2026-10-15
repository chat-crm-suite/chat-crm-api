// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { SelectQueryBuilder } from 'typeorm';

import type { ChannelFilter } from '@contracts';

/**
 * Raw driver values differ between MySQL (Date objects, numeric strings for
 * aggregates) and SQLite (UTC `YYYY-MM-DD HH:MM:SS` strings, integers).
 * Queries select raw columns and normalize them here, so the same SQL runs on
 * both engines.
 */
export function toMillis(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value)
      ? value
      : `${value.replace(' ', 'T')}Z`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const toBool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1';

export const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return null;
};

/** Driver-safe date parameter. */
export const at = (ms: number): Date => new Date(ms);

/** Adds the channel filter on a column holding the channel type. */
export function whereChannel<T extends object>(
  query: SelectQueryBuilder<T>,
  column: string,
  channel: ChannelFilter,
): SelectQueryBuilder<T> {
  return channel === 'all'
    ? query
    : query.andWhere(`${column} = :channelType`, { channelType: channel });
}
