import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column('text')
  refresh_token!: string;

  @Column()
  device_id!: string;

  @Column()
  ip_address!: string;

  @Column()
  expires_at!: Date;

  @CreateDateColumn()
  created_at!: Date;
}
