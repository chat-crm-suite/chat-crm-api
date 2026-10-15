// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '@lib/entities/decimal.transformer';
import { Company } from './company.entity';

/**
 * Assignment-engine settings, 1:1 with `companies` (previously the
 * auto_assign_* columns on the tenant row).
 */
@Entity('company_settings')
export class CompanySettings {
  @PrimaryColumn({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  /** Kill-switch for the assignment engine. */
  @Column({ default: true })
  autoAssignEnabled: boolean;

  /** <= 0 means no limit. */
  @Column({ type: 'int', default: 10 })
  autoAssignMaxOpen: number;

  /** Prefer the previous agent if still eligible. */
  @Column({ default: true })
  autoAssignSticky: boolean;

  @Column({ default: true })
  autoAssignNotifySupervisors: boolean;

  /** `BusinessHoursSchema` shape; NULL = 24/7. Validated on write. */
  @Column({ type: 'json', nullable: true })
  businessHours?: Record<string, unknown> | null;

  /** First-response SLA threshold (seconds). */
  @Column({ type: 'int', default: 300 })
  slaFirstResponseSeconds: number;

  /** Target share answered within the SLA (Erlang C goal). */
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 3,
    default: 0.8,
    transformer: decimalTransformer,
  })
  slaTargetShare: number;

  /** Monthly channel spend budget (USD); NULL = no budget. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  monthlyBudgetUsd?: number | null;

  /** Manual stop for billable outbound sends. */
  @Column({ default: false })
  billableSendsPaused: boolean;

  /** Last budget alert sent (`YYYY-MM:warning|exceeded`), so it fires once. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  budgetAlertKey?: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
