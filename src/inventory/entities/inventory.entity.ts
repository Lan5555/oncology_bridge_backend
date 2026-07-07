import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Hospital } from '../../hospital/entities/hospital.entity';
import { Medicine } from '../../medicine/entities/medicine.entity';

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Hospital, (hospital) => hospital.inventory)
  @JoinColumn({ name: 'hospital_id' })
  hospital!: Hospital;

  @ManyToOne(() => Medicine, (medicine) => medicine.inventory)
  @JoinColumn({ name: 'medicine_id' })
  medicine!: Medicine;

  @Column()
  batch_number!: string;

  @Column()
  serial_number!: string;

  @Column({
    type: 'date',
  })
  expiry_date!: Date;

  @Column()
  quantity!: number;

  @Column({
    default: 'AVAILABLE',
  })
  status!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
