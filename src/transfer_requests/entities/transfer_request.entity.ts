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
