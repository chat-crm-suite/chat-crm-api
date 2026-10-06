// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import type { AssignmentReason } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Conversation } from './conversation.entity';

/**
 * Assignment history. Merges chat_assignments + transfers (a transfer is a row
 * with reason=transfer; "from" is the previous row). No UNIQUE(conversation,
 * member): the same agent can be reassigned later.
 */
@Entity('conversation_assignments')
@Index(['conversationId', 'assignedAt'])
@Index(['memberId', 'unassignedAt'])
export class ConversationAssignment extends UuidV7Entity {
  @Column({ name: 'conversation_id', type: 'varchar', length: 36 })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'member_id', type: 'varchar', length: 36 })
  memberId: string;

  @ManyToOne(() => CompanyMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: CompanyMember;

  /** NULL = system (auto). */
  @Column({ name: 'assigned_by_member_id', type: 'varchar', length: 36, nullable: true })
  assignedByMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_member_id' })
  assignedByMember?: CompanyMember | null;

  @Column({ type: 'varchar', length: 50, default: 'auto' })
  reason: AssignmentReason;

  @Column({ name: 'assigned_at', type: 'datetime' })
  assignedAt: Date;

  /** NULL = active assignment. */
  @Column({ name: 'unassigned_at', type: 'datetime', nullable: true })
  unassignedAt?: Date | null;
}
