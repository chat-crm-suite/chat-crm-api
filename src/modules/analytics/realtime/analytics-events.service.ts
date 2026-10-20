// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import {
  AnalyticsSocketEvent,
  type AnalyticsScope,
  type IaStatus,
  type Presence,
} from '@contracts';
import { Company } from '../../company/entities/company.entity';
import {
  companyRoom,
  ConversationGateway,
} from '../../conversations/gateways/conversation.gateway';
import { AnalyticsCacheService } from '../cache/analytics-cache.service';

/** Window that batches bursts of changes into one `analytics:changed`. */
export const ANALYTICS_BATCH_MS = 2_000;

/**
 * Realtime side of analytics. A change bumps the cache versions at once (the
 * next read recomputes) and is announced to the company room at most once per
 * `ANALYTICS_BATCH_MS`; the payload names scopes only, clients refetch.
 */
@Injectable()
export class AnalyticsEventsService implements OnModuleDestroy {
  private readonly pending = new Map<string, Set<AnalyticsScope>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly gateway: ConversationGateway,
    private readonly cache: AnalyticsCacheService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async signal(companyId: string, scopes: readonly AnalyticsScope[]): Promise<void> {
    if (!scopes.length) return;
    await this.cache.bump(companyId, scopes);

    const set = this.pending.get(companyId) ?? new Set<AnalyticsScope>();
    scopes.forEach((scope) => set.add(scope));
    this.pending.set(companyId, set);

    if (!this.timers.has(companyId)) {
      const timer = setTimeout(() => this.flush(companyId), ANALYTICS_BATCH_MS);
      timer.unref?.();
      this.timers.set(companyId, timer);
    }
  }

  /** Emits the batched scopes of one company. */
  flush(companyId: string): void {
    const timer = this.timers.get(companyId);
    if (timer) clearTimeout(timer);
    this.timers.delete(companyId);

    const scopes = this.pending.get(companyId);
    this.pending.delete(companyId);
    if (!scopes?.size) return;

    this.gateway.server
      ?.to(companyRoom(companyId))
      .emit(AnalyticsSocketEvent.Changed, { companyId, scopes: [...scopes].sort() });
  }

  emitPresence(companyId: string, presence: Presence): void {
    this.gateway.server
      ?.to(companyRoom(companyId))
      .emit(AnalyticsSocketEvent.PresenceChanged, presence);
  }

  /**
   * The IA switch is global, but sockets only ever hear through their
   * company rooms: one emit over every live company (a socket in several
   * gets it once), never a namespace-wide broadcast.
   */
  async emitIaStatus(status: IaStatus): Promise<void> {
    const server = this.gateway.server;
    if (!server || !this.dataSource) return;

    const companies = await this.dataSource.getRepository(Company).find({
      where: { deletedAt: IsNull() },
      select: { id: true },
    });
    if (!companies.length) return;

    server
      .to(companies.map((company) => companyRoom(company.id)))
      .emit(AnalyticsSocketEvent.IaStatusChanged, status);
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.pending.clear();
  }
}
