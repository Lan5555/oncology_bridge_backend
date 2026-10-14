import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InvoiceItem } from './invoice-item.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) reference!: string;
  @Column('uuid') order_id!: string;
  @Column('uuid') pharmacy_facility_id!: string;
  @Column({ default: 'AWAITING_PAYMENT' }) status!: string;
  @Column('int') total_naira!: number;
  @Column({ nullable: true, unique: true }) paystack_reference!: string;
  @Column({ type: 'timestamptz', nullable: true }) paid_at!: Date;
  @CreateDateColumn() created_at!: Date;
  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: true })
  items!: InvoiceItem[];
}
