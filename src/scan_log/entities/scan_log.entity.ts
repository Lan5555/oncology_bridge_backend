import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Inventory } from '../../inventory/entities/inventory.entity';
import { User } from '../../users/entities/user.entity';

@Entity('scan_logs')
export class ScanLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Inventory)
  @JoinColumn({ name: 'inventory_id' })
  inventory!: Inventory;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'scanned_by' })
  scannedBy!: User;

  @Column()
  gtin!: string;

  @Column()
  batch_number!: string;

  @Column()
  serial_number!: string;

  @Column()
  expiry_date!: Date;

  @CreateDateColumn()
  created_at!: Date;
}
