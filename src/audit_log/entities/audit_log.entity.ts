import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column()
  action!: string;

  @Column('text')
  description!: string;

  @Column()
  ip_address!: string;

  @Column({ type: 'uuid', nullable: true, unique: true })
  event_key!: string | null;

  @CreateDateColumn()
  created_at!: Date;
}
