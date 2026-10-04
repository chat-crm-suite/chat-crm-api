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

import type { ChannelStatus, ChannelType } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';

/**
 * A company talks to customers through N channels. Replaces `whatsapp_configs`:
 * adding a provider is a new `type` value + adapter, never a new table.
 * `credentials` is an AES-256-GCM envelope (see credentials.helper).
 */
@Entity('channels')
@Index(['type', 'externalAccountId'], { unique: true })
@Index(['companyId', 'type'])
export class Channel extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'char', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 50 })
  type: ChannelType;

  @Column({ length: 100 })
  name: string;

  /** WhatsApp: phone_number_id. */
  @Column({ name: 'external_account_id', length: 100 })
  externalAccountId: string;

  /** WhatsApp: visible phone number (+51...). */
  @Column({ name: 'display_address', length: 100, nullable: true })
  displayAddress?: string;

  /** Encrypted JSON envelope; plaintext keys per channel type. */
  @Column({ type: 'text' })
  credentials: string;

  /** Non-secret settings: apiVersion, apiBaseUrl, webhookUrl... */
  @Column({ type: 'json', nullable: true })
  settings?: Record<string, unknown> | null;

  @Column({ name: 'webhook_verify_token', length: 256, nullable: true })
  webhookVerifyToken?: string;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  status: ChannelStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
