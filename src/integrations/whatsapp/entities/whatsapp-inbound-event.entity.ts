import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  UpdateDateColumn,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';

/**
 * Durable WhatsApp intake (T1): one row per inbound `wamid`, written before
 * the webhook answers 200. Retries with an already-seen `wamid` hit the
 * unique constraint and are answered 200 without creating work. A crash
 * after persist leaves the `pending` row behind for recovery (T2 replays
 * these events into conversation rows).
 */
@Entity('whatsapp_inbound_events')
@Index(['wamid'], { unique: true })
@Index(['status', 'createdAt'])
export class WhatsappInboundEvent extends UuidV7Entity {
  /** Meta message id (`wamid.*`): the exactly-once key. */
  @Column({ type: 'varchar', length: 255 })
  wamid: string;

  /** `metadata.phone_number_id`: which company line received it. */
  @Column({ name: 'phone_number_id', type: 'varchar', length: 64, nullable: true })
  phoneNumberId?: string | null;

  /** Raw inbound type (`text`, `audio`, ...) for routing/replay. */
  @Column({ name: 'message_type', type: 'varchar', length: 32, nullable: true })
  messageType?: string | null;

  /** Raw inbound message payload, as delivered by Meta. */
  @Column({ type: 'json' })
  payload: Record<string, unknown>;

  /** `pending` until a consumer replays the event into rows (T2). */
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
