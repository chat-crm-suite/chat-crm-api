import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Notification } from '../../notifications/entities/notification.entity';

// Single source of truth for roles/statuses lives in the contracts.
import type { UserRole, UserStatus } from '../../../contracts/index';
export type { UserRole, UserStatus };

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, nullable: true })
  firstName?: string;

  @Column({ length: 255, nullable: true })
  lastName?: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  phoneNumber?: string;

  @Column({ length: 255, unique: true, nullable: true })
  email: string;

  @Column({ unique: true })
  username: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar?: string;

  @Column()
  password: string;

  // Explicit type: the contract type is a re-export, so decorator metadata
  // cannot infer the column type (matches the varchar column).
  @Column({ type: 'varchar', default: 'offline' })
  status: UserStatus;

  @Column({ type: 'varchar', default: 'agent' })
  role: UserRole;

  @Column({ type: 'varchar', length: 512, nullable: true })
  address?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[]
}
