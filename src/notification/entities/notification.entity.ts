import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column()
  title!: string;

  @Column('text')
  message!: string;

  @Column({ type: 'uuid', nullable: true })
  cold_chain_outbox_id!: string | null;
  @Column({ type: 'uuid', nullable: true })
  shipment_temperature_event_id!: string | null;

  @Column({
    default: false,
  })
  read!: boolean;

  @CreateDateColumn()
  created_at!: Date;
}
