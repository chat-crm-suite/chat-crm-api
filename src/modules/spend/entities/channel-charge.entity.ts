// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Column, CreateDateColumn, Entity, Index } from 'typeorm';

import type { ChannelType } from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';

/**
 * What a channel provider reported about an outbound message's cost: its
 * category and whether it is billable. One row per message (idempotent by
 * `messageId`); the amount is derived at read time from `channel_rates`.
 */
@Entity('channel_charges')
@Index('IDX_channel_charges_company_occurred', ['companyId', 'occurredAt'])
@Index('UQ_channel_charges_message', ['messageId'], { unique: true })
export class ChannelCharge extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @Column({ name: 'channel_id', type: 'varchar', length: 36, nullable: true })
  channelId?: string | null;

  @Column({ name: 'channel_type', type: 'varchar', length: 50 })
  channelType: ChannelType;

  @Column({ name: 'message_id', type: 'varchar', length: 36 })
  messageId: string;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({ default: false })
  billable: boolean;

  @Column({ name: 'pricing_model', type: 'varchar', length: 50, nullable: true })
  pricingModel?: string | null;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
