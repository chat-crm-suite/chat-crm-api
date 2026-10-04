import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import type { CustomFieldType } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';

@Entity('custom_field_definitions')
@Index(['companyId', 'key'], { unique: true })
export class CustomFieldDefinition extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ length: 64 })
  key: string;

  @Column({ length: 100 })
  label: string;

  @Column({ name: 'field_type', type: 'varchar', length: 50 })
  fieldType: CustomFieldType;

  /** For select/multiselect. */
  @Column({ type: 'json', nullable: true })
  options?: unknown[] | null;

  @Column({ name: 'is_required', default: false })
  isRequired: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
