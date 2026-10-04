import { Chat, User } from "../../../entities/index";
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { ReasonAssignment } from "../chat.enum";

@Entity()
@Unique(['chat', 'agent'])
export class ChatAssignments {
  @PrimaryGeneratedColumn('uuid', { name: 'chat_assignment_id' })
  id: string;

  @ManyToOne(() => Chat)
  chat: Chat;

  @ManyToOne(() => User)
  agent: User;

  @CreateDateColumn()
  assignedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  unassignedAt?: Date | null;

  @Column({
    type: 'simple-enum',
    enum: ReasonAssignment,
    default: ReasonAssignment.AUTO
  })
  reason: ReasonAssignment;
}