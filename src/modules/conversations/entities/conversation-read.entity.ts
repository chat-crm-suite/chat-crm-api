import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { CompanyMember } from '../../company-members/entities/company-member.entity';
import { Message } from '../../message/entities/message.entity';
import { Conversation } from './conversation.entity';

/**
 * Minimal persistence of read state; unread counters live in Redis and are
 * rebuilt from here.
 */
@Entity('conversation_reads')
export class ConversationRead {
  @PrimaryColumn({ name: 'conversation_id', type: 'varchar', length: 36 })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @PrimaryColumn({ name: 'member_id', type: 'varchar', length: 36 })
  memberId: string;

  @ManyToOne(() => CompanyMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: CompanyMember;

  @Column({ name: 'last_read_message_id', type: 'varchar', length: 36, nullable: true })
  lastReadMessageId?: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'last_read_message_id' })
  lastReadMessage?: Message | null;

  @Column({ name: 'last_read_at', type: 'datetime' })
  lastReadAt: Date;
}
