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
  @CreateDateColumn() at!: Date;
}
