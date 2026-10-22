import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Hospital } from '../../hospital/entities/hospital.entity';
import { Inventory } from '../../inventory/entities/inventory.entity';
import { Medicine } from '../../medicine/entities/medicine.entity';
import { User } from '../../users/entities/user.entity';

@Entity('transfer_requests')
export class TransferRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Hospital)
  @JoinColumn({ name: 'from_hospital' })
  fromHospital!: Hospital;

  @ManyToOne(() => Hospital)
  @JoinColumn({ name: 'to_hospital' })
  toHospital!: Hospital;

  @ManyToOne(() => Medicine)
  @JoinColumn({ name: 'medicine_id' })
  medicine!: Medicine;

  @ManyToOne(() => Inventory)
  @JoinColumn({ name: 'inventory_id' })
  inventory!: Inventory;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'approved_by' })
  approvedBy!: User;

  @Column()
  quantity!: number;

  @Column({ type: 'text', nullable: true })
  selling_unit!: string | null;

  @Column({ type: 'text', nullable: true }) batch_number!: string | null;
  @Column({ type: 'date', nullable: true }) expiry_date!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) dispatched_at!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) delivered_at!: Date | null;
  @Column({ type: 'uuid', nullable: true }) dispatched_by!: string | null;
  @Column({ type: 'uuid', nullable: true }) delivered_by!: string | null;
  @Column({ type: 'uuid', nullable: true }) recipient_inventory_id!:
    string | null;

  @Column({
    default: 'PENDING',
  })
  status!: string;

  @Column({
    nullable: true,
  })
  approved_at!: Date;

  @CreateDateColumn()
  created_at!: Date;
}
