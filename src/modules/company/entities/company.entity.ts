import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { Contact } from '../../contacts/entities/contact.entity';

// Single source of truth for the allowed statuses lives in the contracts.
import type { CompanyStatus } from '../../../contracts/index';
export type { CompanyStatus };

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true, nullable: true })
  email?: string;

  @Column({ length: 50, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  // Explicit type: the contract type is a re-export, so decorator metadata
  // cannot infer the column type (matches the varchar(255) column).
  @Column({ type: 'varchar', default: 'active' })
  status: CompanyStatus;

  /**
   * Configuración de asignación automática de chats (Q18/Q19/Q20).
   * `autoAssignEnabled` es el kill-switch; el resto son reglas del motor.
   */
  @Column({ default: true })
  autoAssignEnabled: boolean;

  /** Tope de chats abiertos activamente asignados por agente. <= 0 = sin tope. */
  @Column({ type: 'int', default: 10 })
  autoAssignMaxChats: number;

  /** Preferir al agente anterior si sigue elegible (sticky, Q5). */
  @Column({ default: true })
  autoAssignSticky: boolean;

  /** Avisar a supervisores cuando un chat queda en la cola sin asignar (Q6/Q12). */
  @Column({ default: true })
  autoAssignNotifySupervisors: boolean;

  @OneToMany(() => Contact, contact => contact.company)
  contacts: Contact[];

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
