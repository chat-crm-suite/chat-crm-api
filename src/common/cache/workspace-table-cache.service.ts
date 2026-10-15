// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { PinoLogger } from 'nestjs-pino';

import type { WorkspaceSocketEvent } from '../../contracts/index';
import { WorkspaceChangedEvent } from '../events/workspace-changed.event';
import { APP_REDIS, type AppRedis } from '../redis/app-redis.module';

export type WorkspaceTable = 'team' | 'customers';

export const tableVersionKey = (table: WorkspaceTable, companyId: string) =>
  `${table}:v:${companyId}`;

/**
 * Cache-aside for the company tables (Equipo, Clientes) in Redis.
 *
 * - Keys embed a per-company version integer; a mutation only `INCR`s it
 *   (O(1)), so stale pages are never read again and simply expire.
 * - Fail-open: any Redis error computes directly, Redis only ever speeds
 *   things up.
 * - `invalidate` also announces the change to the company room (through the
 *   event bus) so open screens refetch.
 */
@Injectable()
export class WorkspaceTableCache {
  constructor(
    @Inject(APP_REDIS) private readonly redis: AppRedis,
    private readonly logger: PinoLogger,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    this.logger.setContext(WorkspaceTableCache.name);
  }

  /** Cached `compute()` for `(table, company, query)`, valid for `ttlMs`. */
  async wrap<T>(
    table: WorkspaceTable,
    companyId: string,
    query: unknown,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    let dataKey: string;
    try {
      const version = (await this.redis.get(tableVersionKey(table, companyId))) ?? '0';
      dataKey = `${table}:d:${companyId}:${version}:${hash(query)}`;
      const hit = await this.redis.get(dataKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.warn(error);
      return compute();
    }

    const value = await compute();
    await this.redis
      .set(dataKey, JSON.stringify(value), 'PX', ttlMs)
      .catch((error: unknown) => this.warn(error));

    return value;
  }

  /** Drops every cached page of the table and pings the company room. */
  async invalidate(
    table: WorkspaceTable,
    companyId: string,
    event: WorkspaceSocketEvent,
    ids?: readonly string[],
  ): Promise<void> {
    try {
      await this.redis.incr(tableVersionKey(table, companyId));
    } catch (error) {
      this.warn(error);
    }

    this.eventBus?.publish(new WorkspaceChangedEvent(companyId, event, ids));
  }

  private warn(error: unknown): void {
    this.logger.warn({ error: String(error) }, 'Table cache unavailable; skipping it');
  }
}

/** Stable hash of a query object (key order does not matter). */
function hash(query: unknown): string {
  return createHash('sha1').update(stableStringify(query)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}
