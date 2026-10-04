import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import type { AnalysisStatus, AnalysisTarget } from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Company } from '../../company/entities/company.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../message/entities/message.entity';

/**
 * Common header for every analysis type. A type needing queryable columns gets
 * a 1:1 detail table (sentiment_results pattern); others use `result` JSON.
 */
@Entity('analyses')
@Index(['conversationId', 'type', 'createdAt'])
@Index(['messageId', 'type'])
export class Analysis extends UuidV7Entity {
  @Column({ name: 'company_id', type: 'char', length: 36 })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 50 })
  target: AnalysisTarget;

  /** CASCADE; used when target=message. */
  @Column({ name: 'message_id', type: 'char', length: 36, nullable: true })
  messageId?: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message?: Message | null;

  /** Always set: enables per-conversation aggregation. */
  @Column({ name: 'conversation_id', type: 'char', length: 36 })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  /** sentiment | intent | topic | ... (varchar: new types need no migration) */
  @Column({ length: 50 })
  type: string;

  @Column({ length: 100, nullable: true })
  model?: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: AnalysisStatus;

  /** Primary result. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  label?: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  confidence?: number | null;

  /** Type-specific payload. */
  @Column({ type: 'json', nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt?: Date | null;
}
