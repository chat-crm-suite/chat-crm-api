// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnModuleDestroy } from '@nestjs/common';

import {
  AnalyticsSocketEvent,
  ConversationSocketEvent,
  type AnalyticsScope,
  type IaStatus,
  type Presence,
} from '@contracts';
import {
  companyRoom,
  ConversationGateway,
  userRoom,
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

  /** The IA switch is global: every connected client hears it. */
  emitIaStatus(status: IaStatus): void {
    this.gateway.server?.emit(AnalyticsSocketEvent.IaStatusChanged, status);
  }

  emitNotification(userId: string, payload: Record<string, unknown>): void {
    this.gateway.server
      ?.to(userRoom(userId))
      .emit(ConversationSocketEvent.NewNotification, payload);
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.pending.clear();
  }
}
