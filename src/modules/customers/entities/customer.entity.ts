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

import type { CustomerSource } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { PipelineStage } from './pipeline-stage.entity';

/**
 * Previously `contacts`. `phone_number` is informational (normalized to
 * `+digits`); incoming customers resolve through `customer_identities`.
 */
@Entity('customers')
@Index(['companyId', 'phoneNumber'], { unique: true })
@Index(['companyId', 'pipelineStageId'])
@Index(['companyId', 'lastInteractionAt'])
export class Customer extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'first_name', length: 100, nullable: true })
  firstName?: string;

  @Column({ name: 'last_name', length: 100, nullable: true })
  lastName?: string;

  @Column({ name: 'display_name', length: 200, nullable: true })
  displayName?: string;

  @Column({ length: 255, nullable: true })
  email?: string;

  /** Canonical `+digits`; informational attribute, not the resolution key. */
  @Column({ name: 'phone_number', length: 20, nullable: true })
  phoneNumber?: string;

  @Column({ name: 'avatar_url', length: 512, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'varchar', length: 50, default: 'manual' })
  source: CustomerSource;

  @Column({ name: 'pipeline_stage_id', type: 'varchar', length: 36, nullable: true })
  pipelineStageId?: string | null;

  @ManyToOne(() => PipelineStage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pipeline_stage_id' })
  pipelineStage?: PipelineStage | null;

  /** Account owner. */
  @Column({ name: 'owner_member_id', type: 'varchar', length: 36, nullable: true })
  ownerMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_member_id' })
  ownerMember?: CompanyMember | null;

  @Column({ name: 'last_interaction_at', type: 'datetime', nullable: true })
  lastInteractionAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
