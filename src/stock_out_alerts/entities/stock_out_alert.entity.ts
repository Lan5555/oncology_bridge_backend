import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

import { Hospital } from '../../hospital/entities/hospital.entity';
import { Medicine } from '../../medicine/entities/medicine.entity';

@Entity('stock_out_alerts')
export class StockOutAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Hospital)
  @JoinColumn({ name: 'hospital_id' })
  hospital!: Hospital;

  @ManyToOne(() => Medicine)
  @JoinColumn({ name: 'medicine_id' })
  medicine!: Medicine;

  @Column()
  requested_quantity!: number;

  @Column({ default: 'OPEN' })
  status!: string;

  @CreateDateColumn()
  created_at!: Date;
}
