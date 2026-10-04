import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Customer } from './customer.entity';

/**
 * Resolution canon: one row per channel identity (WhatsApp wa_id...).
 * `external_id` is stored exactly as the channel reports it.
 */
@Entity('customer_identities')
@Index(['channelId', 'externalId'], { unique: true })
export class CustomerIdentity extends UuidV7Entity {
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

  @Column({ name: 'external_id', length: 100 })
  externalId: string;

  @Column({ name: 'profile_name', length: 200, nullable: true })
  profileName?: string;

  @CreateDateColumn()
  createdAt: Date;
}
