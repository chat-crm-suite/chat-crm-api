// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { MessageStatus } from '../../../contracts/index';
import { Message } from './message.entity';

/**
 * Webhook history (sent/delivered/read). Current state stays in
 * `messages.status`. The only bigint PK: append-only table.
 */
@Entity('message_status_events')
@Index(['messageId', 'occurredAt'])
export class MessageStatusEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'message_id', type: 'varchar', length: 36 })
  messageId: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @Column({ type: 'varchar', length: 50 })
  status: MessageStatus;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt: Date;

  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true })
  errorCode?: string | null;

  @Column({ name: 'raw_payload', type: 'json', nullable: true })
  rawPayload?: Record<string, unknown> | null;
}
