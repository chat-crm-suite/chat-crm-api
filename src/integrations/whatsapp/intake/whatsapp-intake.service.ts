import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { QueryFailedError, Repository } from 'typeorm';

import { WhatsappInboundEvent } from '../entities/whatsapp-inbound-event.entity';

export type IntakeOutcome = 'stored' | 'duplicate';

export interface InboundEventInput {
  wamid: string;
  phoneNumberId?: string | null;
  messageType?: string | null;
  payload: unknown;
}

/**
 * Exactly-once intake store: the unique constraint on `wamid` is the
 * dedupe mechanism, so concurrent retries can never create two rows.
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
      row.phoneNumberId = input.phoneNumberId ?? null;
      row.messageType = input.messageType ?? null;
      row.payload = input.payload as Record<string, unknown>;
      row.status = 'pending';
      await this.events.save(row);
      return 'stored';
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.logger.debug({ wamid: input.wamid }, 'Duplicate webhook wamid');
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
}

/** MySQL 1062 / sqlite UNIQUE: an already-seen `wamid`, never a real error. */
function isDuplicateKeyError(error: unknown): boolean {
  if (error instanceof QueryFailedError) {
    const driverError = error.driverError as
      | { code?: string; errno?: number }
      | undefined;
    if (
      driverError?.code === 'ER_DUP_ENTRY' ||
      driverError?.errno === 1062
    ) {
      return true;
    }
    return /UNIQUE constraint failed/i.test(error.message);
  }
  return false;
}
