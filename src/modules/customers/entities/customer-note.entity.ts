import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Customer } from './customer.entity';

/** Internal notes, never sent to the customer. */
@Entity('customer_notes')
export class CustomerNote extends UuidV7Entity {
  @Column({ name: 'customer_id', type: 'varchar', length: 36 })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  /** Optional: note written from a conversation. */
  @Column({ name: 'conversation_id', type: 'varchar', length: 36, nullable: true })
  conversationId?: string | null;

  @ManyToOne(() => Conversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation | null;

  @Column({ name: 'author_member_id', type: 'varchar', length: 36 })
  authorMemberId: string;

  @ManyToOne(() => CompanyMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_member_id' })
  authorMember: CompanyMember;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
