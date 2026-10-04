import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Company } from './company.entity';

/**
 * Assignment-engine settings, 1:1 with `companies` (previously the
 * auto_assign_* columns on the tenant row).
 */
@Entity('company_settings')
export class CompanySettings {
  @PrimaryColumn({ name: 'company_id', type: 'char', length: 36 })
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

  @Column({ type: 'json', nullable: true })
  businessHours?: Record<string, unknown> | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
