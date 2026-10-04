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

import type {
  ConversationPriority,
  ConversationStatus,
} from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Company } from '../../company/entities/company.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Message } from '../../message/entities/message.entity';

/** Previously `chats`; now tenant-direct (company_id NOT NULL). */
@Entity('conversations')
@Index(['companyId', 'status', 'lastMessageAt'])
@Index(['companyId', 'assignedMemberId', 'status'])
@Index(['companyId', 'customerId'])
export class Conversation extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'char', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'customer_id', type: 'char', length: 36 })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'channel_id', type: 'char', length: 36 })
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'varchar', length: 50, default: 'open' })
  status: ConversationStatus;

  @Column({ type: 'varchar', length: 50, default: 'low' })
  priority: ConversationPriority;

  /** Current assignee (denormalized from conversation_assignments). */
  @Column({ name: 'assigned_member_id', type: 'char', length: 36, nullable: true })
  assignedMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_member_id' })
  assignedMember?: CompanyMember | null;

  /** Kept for the inbox list, but NOT eager. */
  @Column({ name: 'last_message_id', type: 'char', length: 36, nullable: true })
  lastMessageId?: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'last_message_id' })
  lastMessage?: Message | null;

  @Column({ name: 'last_message_at', type: 'datetime', nullable: true })
  lastMessageAt?: Date;

  /** WA 24h window + needs-response view. */
  @Column({ name: 'last_inbound_at', type: 'datetime', nullable: true })
  lastInboundAt?: Date;

  @Column({ name: 'last_outbound_at', type: 'datetime', nullable: true })
  lastOutboundAt?: Date;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt?: Date;

  @Column({ name: 'closed_by_member_id', type: 'char', length: 36, nullable: true })
  closedByMemberId?: string | null;

  @ManyToOne(() => CompanyMember, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'closed_by_member_id' })
  closedByMember?: CompanyMember | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
