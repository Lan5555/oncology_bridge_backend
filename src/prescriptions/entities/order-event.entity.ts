import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('order_events')
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') order_id!: string;
  @Column() step!: string;
  @Column({ default: 'pending' }) state!: string;
  @Column({ type: 'text', nullable: true }) event_type!: string | null;
  @Column({ type: 'text', nullable: true }) message!: string | null;
  @Column({ type: 'uuid', nullable: true }) actor_id!: string | null;
  @Column({ type: 'int', nullable: true }) review_version!: number | null;
  @CreateDateColumn() at!: Date;
}
