// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Column, Entity, Index } from 'typeorm';

import type { ManualPresenceState } from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';

/**
 * Time a member spent connected in one state (`available` / `away`).
 * Offline time is the absence of an interval. `endedAt` NULL = ongoing.
 */
@Entity('presence_intervals')
@Index('IDX_presence_intervals_company_started', ['companyId', 'startedAt'])
@Index('IDX_presence_intervals_member_ended', ['memberId', 'endedAt'])
export class PresenceInterval extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @Column({ name: 'member_id', type: 'varchar', length: 36 })
  memberId: string;

  @Column({ type: 'varchar', length: 20 })
  state: ManualPresenceState;

  @Column({ name: 'started_at', type: 'datetime' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt?: Date | null;
}
