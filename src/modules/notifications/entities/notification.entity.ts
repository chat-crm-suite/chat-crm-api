// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';

/**
 * Durable history (bell list). Realtime delivery, unread badge and dedupe live
 * in Redis (Phase 2); a reconnecting client replays from the Redis stream.
 */
@Entity('notifications')
@Index(['recipientMemberId', 'readAt', 'createdAt'])
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

  /** conversation_assigned, queue_unassigned, ... */
  @Column({ length: 50 })
  type: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /** {conversation_id, ...} for deep-linking. */
  @Column({ type: 'json', nullable: true })
  data?: Record<string, unknown> | null;

  /** NULL = unread. */
  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
