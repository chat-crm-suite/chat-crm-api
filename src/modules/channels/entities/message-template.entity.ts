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

import type {
  TemplateCategory,
  TemplateComponent,
  TemplateComponentType,
  TemplateStatus,
} from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { Channel } from './channel.entity';

/** A placeholder of a template as found by the provider sync. */
export interface StoredTemplateVariable {
  key: string;
  component: TemplateComponentType;
  example: string | null;
}

/** Provider-approved templates (WhatsApp HSM). */
@Entity('message_templates')
@Index(['channelId', 'name', 'language'], { unique: true })
export class MessageTemplate extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'channel_id', type: 'varchar', length: 36 })
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ length: 512 })
  name: string;

  @Column({ length: 10 })
  language: string;

  @Column({ type: 'varchar', length: 50 })
  category: TemplateCategory;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: TemplateStatus;

  /** Provider reason when `rejected`/`paused`. */
  @Column({ name: 'status_reason', type: 'varchar', length: 500, nullable: true })
  statusReason?: string | null;

  /** Normalized, provider-neutral components (`TemplateComponentSchema[]`). */
  @Column({ type: 'json' })
  components: TemplateComponent[];

  /** Placeholders found at sync time, with the provider's sample value. */
  @Column({ type: 'json', nullable: true })
  variables?: StoredTemplateVariable[] | null;

  /** CRM labels by `${component}:${key}` (admin setting, never synced). */
  @Column({ name: 'variable_labels', type: 'json', nullable: true })
  variableLabels?: Record<string, string> | null;

  /** Agents only see (and send) approved templates with this flag on. */
  @Column({ name: 'visible_to_agents', type: 'boolean', default: true })
  visibleToAgents: boolean;

  @Column({ name: 'external_id', type: 'varchar', length: 100, nullable: true })
  externalId?: string | null;

  /** Last time the provider reported this template. */
  @Column({ name: 'synced_at', type: 'datetime', nullable: true })
  syncedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
