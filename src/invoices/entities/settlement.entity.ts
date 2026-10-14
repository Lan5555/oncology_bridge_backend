import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('settlements')
export class Settlement {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice!: Invoice;
  @Column('int') amount_naira!: number;
  @Column('int') platform_fee_naira!: number;
  @Column({ default: 'QUEUED' }) payout_status!: string;
  @CreateDateColumn() created_at!: Date;
}
