import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import type { TemplateCategory, TemplateStatus } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { Channel } from './channel.entity';

/** Provider-approved templates (WhatsApp HSM). */
@Entity('message_templates')
@Index(['channelId', 'name', 'language'], { unique: true })
export class MessageTemplate extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'char', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'channel_id', type: 'char', length: 36 })
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

  @Column({ type: 'json' })
  components: Record<string, unknown>;

  @Column({ name: 'external_id', length: 100, nullable: true })
  externalId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
