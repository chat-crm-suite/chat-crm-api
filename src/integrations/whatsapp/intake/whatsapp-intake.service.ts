// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import { isDuplicateKeyError } from '../../../lib/helpers/query-error.helper';
import { WhatsappInboundEvent } from '../entities/whatsapp-inbound-event.entity';

export type IntakeOutcome = 'stored' | 'duplicate';

export interface InboundEventInput {
  wamid: string;
  /** `message` (default) or `status:<state>`: part of the dedupe key. */
  kind?: string;
  phoneNumberId?: string | null;
  messageType?: string | null;
  payload: unknown;
}

/**
 * Exactly-once intake store: the unique constraint on `(wamid, kind)` is the
 * dedupe mechanism, so concurrent retries can never create two rows and a
 * status tick never collides with the message event of the same wamid.
 */
@Injectable()
export class WhatsAppIntakeService {
  constructor(
    @InjectRepository(WhatsappInboundEvent)
    private readonly events: Repository<WhatsappInboundEvent>,
    private readonly logger: PinoLogger,
  ) {}

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
}
