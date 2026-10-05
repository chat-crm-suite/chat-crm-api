import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  UpdateDateColumn,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';

/**
 * Identity/login only. No role (that lives in `company_members`) and no
 * presence status (Redis).
 */
@Entity('users')
export class User extends UuidV7Entity {
  @Column({ length: 255, unique: true, nullable: true })
  email?: string;

  @Column({ length: 100, unique: true })
  username: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash: string;

  @Column({ length: 100, nullable: true })
  firstName?: string;

  @Column({ length: 100, nullable: true })
  lastName?: string;

  @Column({ length: 20, nullable: true, unique: true })
  phoneNumber?: string;

  @Column({ name: 'avatar_url', length: 512, nullable: true })
  avatarUrl?: string;

  /** SaaS superadmin; business role lives in `company_members`. */
  @Column({ name: 'is_platform_admin', default: false })
  isPlatformAdmin: boolean;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
