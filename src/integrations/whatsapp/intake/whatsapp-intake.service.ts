// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { LessThan, Repository } from 'typeorm';

import { isDuplicateKeyError } from '../../../lib/helpers/query-error.helper';
import { WhatsappInboundEvent } from '../entities/whatsapp-inbound-event.entity';

export type IntakeOutcome = 'stored' | 'duplicate';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Time-based purge window for `replayed` intake events (ticket #19 spec
 * decision: "durable replayed events get a time-based purge"). A replayed row
 * is only recovery material until it is acknowledged, and `pending` rows are
 * never touched. Configurable through `WHATSAPP_INTAKE_REPLAY_RETENTION_DAYS`.
 */
export const INBOUND_REPLAY_RETENTION_MS =
  (Number(process.env.WHATSAPP_INTAKE_REPLAY_RETENTION_DAYS) || 7) * DAY_MS;

export interface InboundEventInput {
  wamid: string;
  /** `message` (default) or `status:<state>`: part of the dedupe key. */
  kind?: string;
  phoneNumberId?: string | null;
  messageType?: string | null;
  /**
   * Sender profile-name snapshot for live/replay parity (ticket #22): the
   * stored raw payload carries no contacts, so the replay path rehydrates
   * the customer display name from here.
   */
  senderName?: string | null;
  payload: unknown;
}

/**
 * Exactly-once intake store: the unique constraint on `(wamid, kind)` is the
 * dedupe mechanism, so concurrent retries can never create two rows and a
 * status tick never collides with the message event of the same wamid.
 */
@Injectable()
export class WhatsAppIntakeService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(WhatsappInboundEvent)
    private readonly events: Repository<WhatsappInboundEvent>,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Boot housekeeping: drop replayed rows past their retention window so the
   * durable store only ever holds live recovery material. Best-effort: a
   * failed purge warns and never blocks startup.
   */
  onApplicationBootstrap(): void {
    void this.purgeReplayed().catch((error: unknown) =>
      this.logger.warn({ error }, 'Inbound intake purge failed'),
    );
  }

  async persistIfNew(input: InboundEventInput): Promise<IntakeOutcome> {
    if (!input.wamid) {
      throw new Error('Cannot persist an inbound event without wamid');
    }

    try {
      // One INSERT (no id set, so `save` inserts and `@BeforeInsert`
      // generates the uuidv7): the unique `wamid` constraint decides stored
      // vs duplicate, even under concurrency.
      const row = this.events.create();
      row.wamid = input.wamid;
      row.kind = input.kind ?? 'message';
      row.phoneNumberId = input.phoneNumberId ?? null;
      row.messageType = input.messageType ?? null;
      row.senderName = input.senderName ?? null;
      row.payload = input.payload as Record<string, unknown>;
      row.status = 'pending';
      await this.events.save(row);
      return 'stored';
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.logger.debug(
          { wamid: input.wamid, kind: input.kind ?? 'message' },
          'Duplicate webhook event',
        );
        return 'duplicate';
      }
      throw error;
    }
  }

  /** Recovery hook: events persisted but never replayed into rows. */
  listPending(limit: number): Promise<WhatsappInboundEvent[]> {
    return this.events.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /** Ticket #24 gauge: how many intake events still await a replay. */
  countPending(): Promise<number> {
    return this.events.count({ where: { status: 'pending' } });
  }

  /**
   * Consumes one pending event (T2): once its conversation row (or applied
   * status) exists, it must never be replayed again. Idempotent: an
   * already-consumed or unknown `(wamid, kind)` is a noop.
   */
  async markReplayed(wamid: string, kind = 'message'): Promise<void> {
    if (!wamid) return;

    await this.events.update(
      { wamid, kind, status: 'pending' },
      { status: 'replayed' },
    );
  }

  /**
   * Purges `replayed` events whose last touch is older than the retention
   * window, returning how many rows were deleted. `pending` events are never
   * purged: they are still recovery material. The window defaults to
   * {@link INBOUND_REPLAY_RETENTION_MS} and is overridable per call.
   */
  async purgeReplayed(
    retentionMs = INBOUND_REPLAY_RETENTION_MS,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    const result = await this.events.delete({
      status: 'replayed',
      updatedAt: LessThan(cutoff),
    });
    const purged = result.affected ?? 0;

    if (purged > 0) {
      this.logger.debug(
        { purged, cutoff },
        'Purged replayed inbound intake events',
      );
    }

    return purged;
  }
}
