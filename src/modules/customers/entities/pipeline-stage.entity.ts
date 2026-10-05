import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';

/** Configurable sales stages per company (replaces contacts.status). */
@Entity('pipeline_stages')
@Index(['companyId', 'name'], { unique: true })
export class PipelineStage extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ length: 7, nullable: true })
  color?: string;

  @Column({ name: 'is_won', default: false })
  isWon: boolean;

  @Column({ name: 'is_lost', default: false })
  isLost: boolean;
}
