// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  UpdateDateColumn,
} from 'typeorm';

import type { CompanyStatus } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';

/**
 * Tenant root. The assignment settings that used to live here moved to
 * `company_settings` (1:1).
 */
@Entity('companies')
export class Company extends UuidV7Entity {
  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, nullable: true, unique: true })
  email?: string;

  @Column({ length: 20, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ length: 64, default: 'America/Lima' })
  timezone: string;

  // Explicit type: contract union types cannot be inferred by decorator metadata.
  @Column({ type: 'varchar', length: 50, default: 'active' })
  status: CompanyStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
