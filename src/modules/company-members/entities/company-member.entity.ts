import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import type { MemberRole, MemberStatus } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
