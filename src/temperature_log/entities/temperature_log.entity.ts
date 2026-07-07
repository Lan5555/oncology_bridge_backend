import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { TransferRequest } from '../../transfer_requests/entities/transfer_request.entity';

@Entity('temperature_logs')
export class TemperatureLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TransferRequest)
  @JoinColumn({ name: 'transfer_id' })
  transfer!: TransferRequest;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  temperature!: number;

  @CreateDateColumn()
  recorded_at!: Date;
}
