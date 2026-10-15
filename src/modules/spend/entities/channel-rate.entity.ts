// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Column, Entity, Index, UpdateDateColumn } from 'typeorm';

import type { ChannelType } from '@contracts';
import { decimalTransformer } from '@lib/entities/decimal.transformer';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';

/** Company-editable price (USD) of one billable unit per channel + category. */
@Entity('channel_rates')
@Index(
  'UQ_channel_rates_company_channel_category',
  ['companyId', 'channelType', 'category'],
  { unique: true },
)
export class ChannelRate extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 50 })
  channelType: ChannelType;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({
    name: 'usd_per_unit',
    type: 'decimal',
    precision: 10,
    scale: 6,
    default: 0,
    transformer: decimalTransformer,
  })
  usdPerUnit: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
