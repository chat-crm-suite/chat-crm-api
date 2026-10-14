// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import type {
  MemberRole,
  MemberStatus,
  NotificationPreferences,
} from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { User } from '../../users/entities/user.entity';

/**
 * A user inside a company (agent/supervisor/admin). Every business FK to
 * "a staff person" points here, not to `users`.
 */
@Entity('company_members')
@Index(['companyId', 'userId'], { unique: true })
@Index(['companyId', 'role', 'status'])
export class CompanyMember extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 50, default: 'agent' })
  role: MemberRole;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  status: MemberStatus;

  @Column({ name: 'accepts_auto_assign', default: true })
  acceptsAutoAssign: boolean;

  /** Overrides company_settings.auto_assign_max_open. */
  @Column({ name: 'max_open_conversations', type: 'int', nullable: true })
  maxOpenConversations?: number;

  @Column({ name: 'joined_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  joinedAt: Date;

  /** Member that added this one (audit); null for the setup/console admin. */
  @Column({ name: 'created_by_member_id', type: 'varchar', length: 36, nullable: true })
  createdByMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_member_id' })
  createdByMember?: CompanyMember | null;

  /** Per-member notification preferences (`NotificationPreferences`). */
  @Column({ name: 'notification_prefs', type: 'json', nullable: true })
  notificationPrefs?: NotificationPreferences | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Soft delete: the member leaves the company but keeps its history. Adding
   * the same account again restores this row (unique `(company, user)`).
   */
  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
