// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import type { CaseStatus, ChannelType } from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';

/**
 * One support case inside a conversation thread: opens on the first inbound
 * message without an open case, closes explicitly. Timestamps are stored raw;
 * analytics turns them into business-time durations at read time, so editing
 * the business hours re-measures history consistently.
 *
 * `openKey` equals `conversationId` while the case is open and NULL once
 * closed: its unique index allows a single open case per conversation even
 * under concurrent inbound messages (NULLs never collide).
 */
@Entity('cases')
@Index('IDX_cases_company_opened', ['companyId', 'openedAt'])
@Index('IDX_cases_company_closed', ['companyId', 'closedAt'])
@Index('IDX_cases_company_status', ['companyId', 'status'])
@Index('IDX_cases_conversation_opened', ['conversationId', 'openedAt'])
@Index('UQ_cases_open_key', ['openKey'], { unique: true })
export class Case extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id', foreignKeyConstraintName: 'FK_cases_company' })
  company: Company;

  @Column({ name: 'conversation_id', type: 'varchar', length: 36 })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'FK_cases_conversation',
  })
  conversation: Conversation;

  /** Denormalized from the conversation's channel (filter without a join). */
  @Column({ name: 'channel_type', type: 'varchar', length: 50 })
  channelType: ChannelType;

  @Column({ name: 'customer_id', type: 'varchar', length: 36 })
  customerId: string;

  @Column({ type: 'varchar', length: 50, default: 'open' })
  status: CaseStatus;

  @Column({ name: 'open_key', type: 'varchar', length: 36, nullable: true })
  openKey?: string | null;

  @Column({ name: 'opened_at', type: 'datetime' })
  openedAt: Date;

  @Column({ name: 'first_response_at', type: 'datetime', nullable: true })
  firstResponseAt?: Date | null;

  @Column({
    name: 'first_responder_member_id',
    type: 'varchar',
    length: 36,
    nullable: true,
  })
  firstResponderMemberId?: string | null;

  /**
   * Start of the customer's unanswered burst (NULL once a member replied):
   * drives the live waiting list and each reply-time sample.
   */
  @Column({ name: 'awaiting_reply_since', type: 'datetime', nullable: true })
  awaitingReplySince?: Date | null;

  @Column({ name: 'inbound_count', type: 'int', default: 0 })
  inboundCount: number;

  @Column({ name: 'outbound_count', type: 'int', default: 0 })
  outboundCount: number;

  /** Owner when closed (the assignee at that moment). */
  @Column({ name: 'owner_member_id', type: 'varchar', length: 36, nullable: true })
  ownerMemberId?: string | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'closed_by_member_id', type: 'varchar', length: 36, nullable: true })
  closedByMemberId?: string | null;

  @Column({ name: 'close_note', type: 'varchar', length: 500, nullable: true })
  closeNote?: string | null;

  @Column({ name: 'reopen_of_case_id', type: 'varchar', length: 36, nullable: true })
  reopenOfCaseId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
