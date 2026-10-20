// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';

/**
 * Durable history (bell list) and the source of truth for replay: a
 * reconnecting client refetches from here. Redis only speeds delivery up
 * (dedupe keys, unread-count cache); see `NotificationDeliveryService`.
 */
@Entity('notifications')
@Index(['recipientMemberId', 'readAt', 'createdAt'])
@Index(['recipientMemberId', 'groupKey', 'readAt'])
@Index(['recipientMemberId', 'companyId', 'updatedAt'])
export class Notification extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'recipient_member_id', type: 'varchar', length: 36 })
  recipientMemberId: string;

  @ManyToOne(() => CompanyMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_member_id' })
  recipientMember: CompanyMember;

  /** `NotificationType`. */
  @Column({ length: 50 })
  type: string;

  /** `NotificationSeverity`. */
  @Column({ length: 20, default: 'info' })
  severity: string;

  /** Unread rows sharing it collapse into one (`count` grows). */
  @Column({ name: 'group_key', type: 'varchar', length: 120, nullable: true })
  groupKey?: string | null;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /** `NotificationData`: ids for deep-linking. */
  @Column({ type: 'json', nullable: true })
  data?: Record<string, unknown> | null;

  /** NULL = unread. */
  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  /** Bumped when a grouped row grows; the bell orders and replays by it. */
  @UpdateDateColumn({ name: 'updated_at', precision: 6 })
  updatedAt: Date;
}
