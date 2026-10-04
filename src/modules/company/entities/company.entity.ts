import { IsOptional, IsPhoneNumber } from 'class-validator';
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

export type CompanyStatus = 'active' | 'inactive' | 'suspended';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true, nullable: true })
  email?: string;

  @Column({ length: 50, nullable: true })
  @IsPhoneNumber()
  @IsOptional()
  phoneNumber?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ default: 'active' })
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
