import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CustomFieldDefinition } from './custom-field-definition.entity';
import { Customer } from './customer.entity';

@Entity('customer_custom_values')
export class CustomerCustomValue {
  @PrimaryColumn({ name: 'customer_id', type: 'char', length: 36 })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @PrimaryColumn({ name: 'field_id', type: 'char', length: 36 })
  fieldId: string;

  @ManyToOne(() => CustomFieldDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'field_id' })
  field: CustomFieldDefinition;

  @Column({ type: 'text', nullable: true })
  value?: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
