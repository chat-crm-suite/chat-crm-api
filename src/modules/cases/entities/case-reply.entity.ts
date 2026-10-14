// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Case } from './case.entity';

/**
 * One answered customer burst: from the first unanswered inbound message to
 * the member reply that answered it (append-only). Reply-time percentiles
 * read these rows instead of pairing messages at query time.
 */
@Entity('case_replies')
@Index('IDX_case_replies_company_replied', ['companyId', 'repliedAt'])
@Index('IDX_case_replies_case', ['caseId'])
export class CaseReply extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @Column({ name: 'case_id', type: 'varchar', length: 36 })
  caseId: string;

  @ManyToOne(() => Case, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id', foreignKeyConstraintName: 'FK_case_replies_case' })
  case: Case;

  @Column({ name: 'member_id', type: 'varchar', length: 36, nullable: true })
  memberId?: string | null;

  @Column({ name: 'awaited_from', type: 'datetime' })
  awaitedFrom: Date;

  @Column({ name: 'replied_at', type: 'datetime' })
  repliedAt: Date;

  /** True for the reply that answered the case's first message. */
  @Column({ name: 'is_first', default: false })
  isFirst: boolean;
}
