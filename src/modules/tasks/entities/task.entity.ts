// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import type { TaskPriority, TaskStatus } from '@contracts';
import { UuidV7Entity } from '@lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Customer } from '../../customers/entities/customer.entity';

/**
 * A manual work item assigned to one member, optionally linked to a
 * conversation and/or a customer. Automatic alerts are never stored here:
 * they are derived live by the work queue.
 */
@Entity('tasks')
@Index('IDX_tasks_company_assignee_status', ['companyId', 'assigneeMemberId', 'status'])
@Index('IDX_tasks_company_status_due', ['companyId', 'status', 'dueAt'])
@Index('IDX_tasks_conversation', ['conversationId'])
export class Task extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'varchar', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id', foreignKeyConstraintName: 'FK_tasks_company' })
  company: Company;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'open' })
  status: TaskStatus;

  @Column({ type: 'varchar', length: 50, default: 'medium' })
  priority: TaskPriority;

  @Column({ name: 'due_at', type: 'datetime', nullable: true })
  dueAt?: Date | null;

  @Column({ name: 'assignee_member_id', type: 'varchar', length: 36 })
  assigneeMemberId: string;

  @ManyToOne(() => CompanyMember, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'assignee_member_id',
    foreignKeyConstraintName: 'FK_tasks_assignee',
  })
  assignee: CompanyMember;

  @Column({ name: 'created_by_member_id', type: 'varchar', length: 36, nullable: true })
  createdByMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_member_id',
    foreignKeyConstraintName: 'FK_tasks_created_by',
  })
  createdBy?: CompanyMember | null;

  @Column({ name: 'conversation_id', type: 'varchar', length: 36, nullable: true })
  conversationId?: string | null;

  @ManyToOne(() => Conversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'FK_tasks_conversation',
  })
  conversation?: Conversation | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 36, nullable: true })
  customerId?: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id', foreignKeyConstraintName: 'FK_tasks_customer' })
  customer?: Customer | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date | null;
}
