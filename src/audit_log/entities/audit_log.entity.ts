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

  @Column({ type: 'varchar', length: 64, nullable: true })
  object_type!: string | null;

  @Column({ type: 'uuid', nullable: true })
  object_id!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  request_id!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  before_status!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  after_status!: string | null;

  @CreateDateColumn()
  created_at!: Date;
}
