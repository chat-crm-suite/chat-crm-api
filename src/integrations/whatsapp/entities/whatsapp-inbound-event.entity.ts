// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  UpdateDateColumn,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';

/**
 * Durable WhatsApp intake (T1): one row per inbound event, written before
 * the webhook answers 200. Retries with an already-seen `(wamid, kind)` hit
 * the unique constraint and are answered 200 without creating work. A crash
 * after persist leaves the `pending` row behind for recovery (T2 replays
 * these events into conversation rows, T4 applies their status ticks).
 */
@Entity('whatsapp_inbound_events')
@Index(['wamid', 'kind'], { unique: true })
@Index(['status', 'createdAt'])
export class WhatsappInboundEvent extends UuidV7Entity {
  /** Meta message id (`wamid.*`): half of the exactly-once key. */
  @Column({ type: 'varchar', length: 255 })
  wamid: string;

  /**
   * Event family: `message` or `status:<sent|delivered|read|failed>`. Scopes
   * the unique key so a status tick never collides with the message event of
   * the same wamid.
   */
  @Column({ type: 'varchar', length: 32, default: 'message' })
  kind: string;

  /** `metadata.phone_number_id`: which company line received it. */
  @Column({
    name: 'phone_number_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
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
