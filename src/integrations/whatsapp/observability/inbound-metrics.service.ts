// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { safely } from '../../../modules/analysis/ia/ia-safety';
import type { AttachmentType } from '../../../contracts/index';
import { ENRICH_MEDIA_QUEUE } from '../intake/enrich-media.queue';
import { WhatsAppIntakeService } from '../intake/whatsapp-intake.service';
import type {
  InboundContentType,
  InboundDiscardReason,
} from '../types/inbound-message.types';
import { INBOUND_METRICS_REDIS } from './inbound-metrics.redis';

/** Counters reset daily: the TTL is set when a hash is born, never extended. */
export const INBOUND_METRICS_TTL_SECONDS = 24 * 60 * 60;

/**
 * Redis hashes of the inbound operational counters. Fields are bounded labels
 * only — a message type or a discard reason — never a message id, attachment
 * id, media id or phone number (ticket #24).
 */
export const INBOUND_METRICS_KEYS = {
  received: 'inbound:metrics:received',
  discardedByType: 'inbound:metrics:discarded:type',
  discardedByReason: 'inbound:metrics:discarded:reason',
  mediaEnriched: 'inbound:metrics:media:enriched',
  mediaFailed: 'inbound:metrics:media:failed',
} as const;

export interface InboundCounters {
  received: number;
  receivedByType: Record<string, number>;
  discarded: number;
  discardedByType: Record<string, number>;
  discardedByReason: Record<string, number>;
  mediaEnriched: number;
  mediaFailed: number;
}

export interface InboundMetricsSnapshot {
  counts: InboundCounters;
  gauges: { queueDepth: number; intakeBacklog: number };
  timestamp: string;
}

/**
 * Ticket #24 operational counters for the inbound pipeline. Every domain fact
 * bumps one of these through the metrics subscriber, labelled by `type` (and
 * `reason`) only. Writes and reads are best-effort: a metrics failure logs at
 * `warn` and never breaks the inbound flow. `snapshot()` exposes the counters
 * plus the queue-depth and intake-backlog gauges.
 */
@Injectable()
export class InboundMetricsService {
  constructor(
    @Inject(INBOUND_METRICS_REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly intake: WhatsAppIntakeService,
    @InjectQueue(ENRICH_MEDIA_QUEUE) private readonly enrichQueue: Queue,
  ) {
    this.logger.setContext(InboundMetricsService.name);
  }

  recordReceived(type: InboundContentType): Promise<void> {
    return this.bump(INBOUND_METRICS_KEYS.received, type, 'received count');
  }

  recordDiscarded(
    type: string,
    reason: InboundDiscardReason,
  ): Promise<void> {
    return Promise.all([
      this.bump(
        INBOUND_METRICS_KEYS.discardedByType,
        type,
        'discard type count',
      ),
      this.bump(
        INBOUND_METRICS_KEYS.discardedByReason,
        reason,
        'discard reason count',
      ),
    ]).then(() => undefined);
  }

  recordMediaEnriched(type: AttachmentType): Promise<void> {
    return this.bump(
      INBOUND_METRICS_KEYS.mediaEnriched,
      type,
      'enriched media count',
    );
  }

  recordMediaFailed(type: AttachmentType): Promise<void> {
    return this.bump(
      INBOUND_METRICS_KEYS.mediaFailed,
      type,
      'failed media count',
    );
  }

  async snapshot(): Promise<InboundMetricsSnapshot> {
    const [
      received,
      discardedByType,
      discardedByReason,
      enriched,
      failed,
      gauges,
    ] = await Promise.all([
      this.read(INBOUND_METRICS_KEYS.received),
      this.read(INBOUND_METRICS_KEYS.discardedByType),
      this.read(INBOUND_METRICS_KEYS.discardedByReason),
      this.read(INBOUND_METRICS_KEYS.mediaEnriched),
      this.read(INBOUND_METRICS_KEYS.mediaFailed),
      this.readGauges(),
    ]);

    return {
      counts: {
        received: sum(received),
        receivedByType: received,
        discarded: sum(discardedByType),
        discardedByType,
        discardedByReason,
        mediaEnriched: sum(enriched),
        mediaFailed: sum(failed),
      },
      gauges,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Counter birth: `HSETNX` creates the field and, only while the hash has no
   * deadline, `EXPIRE` gives the whole hash a 24h TTL — later increments keep
   * the original deadline (daily reset, not a sliding window).
   */
  private async bump(key: string, field: string, label: string): Promise<void> {
    await safely(
      this.logger,
      undefined,
      async () => {
        const created = await this.redis.hsetnx(key, field, '0');
        if (created === 1 && (await this.redis.ttl(key)) < 0) {
          await this.redis.expire(key, INBOUND_METRICS_TTL_SECONDS);
        }
        await this.redis.hincrby(key, field, 1);
      },
      `Inbound metrics: ${label} could not be recorded`,
    );
  }

  private read(key: string): Promise<Record<string, number>> {
    return safely(
      this.logger,
      {},
      async () => {
        const hash = await this.redis.hgetall(key);
        return Object.fromEntries(
          Object.entries(hash).map(([field, value]) => [field, toCount(value)]),
        );
      },
      `Inbound metrics: ${key} read failed; reporting zeros`,
    );
  }

  private async readGauges(): Promise<{
    queueDepth: number;
    intakeBacklog: number;
  }> {
    const [queueDepth, intakeBacklog] = await Promise.all([
      safely(
        this.logger,
        0,
        async () => {
          const counts = await this.enrichQueue.getJobCounts(
            'waiting',
            'delayed',
            'active',
          );
          return (
            (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0)
          );
        },
        'Inbound metrics: queue depth read failed; reporting zero',
      ),
      safely(
        this.logger,
        0,
        () => this.intake.countPending(),
        'Inbound metrics: intake backlog read failed; reporting zero',
      ),
    ]);

    return { queueDepth, intakeBacklog };
  }
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function toCount(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
