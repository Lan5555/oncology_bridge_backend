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
import { Hospital } from '../../hospital/entities/hospital.entity';

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

  @ManyToOne(() => Hospital, { nullable: true })
  @JoinColumn({ name: 'facility_id' })
  facility!: Hospital | null;

  @Column()
  gtin!: string;

  @Column()
  batch_number!: string;

  @Column()
  serial_number!: string;

  @Column()
  expiry_date!: Date;

  @Column({ type: 'uuid', unique: true, nullable: true })
  client_uuid!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  client_ts!: Date | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  action!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column({ default: 'CLEAN' })
  result!: string;

  @CreateDateColumn()
  created_at!: Date;
}
