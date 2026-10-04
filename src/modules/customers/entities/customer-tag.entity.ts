import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Customer } from './customer.entity';
import { Tag } from './tag.entity';

/** Join table: replaces the `contacts.tags` CSV column. */
@Entity('customer_tags')
@Index(['tagId'])
export class CustomerTag {
  @PrimaryColumn({ name: 'customer_id', type: 'varchar', length: 36 })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @PrimaryColumn({ name: 'tag_id', type: 'varchar', length: 36 })
  tagId: string;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag: Tag;
}
