import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TransferRequest } from '../../transfer_requests/entities/transfer_request.entity';
import { StorageUnit } from '../../storage_units/entities/storage-unit.entity';
import { IotDevice } from '../../iot_devices/entities/iot-device.entity';

@Entity('temperature_logs')
export class TemperatureLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TransferRequest, { nullable: true })
  @JoinColumn({ name: 'transfer_id' })
  transfer!: TransferRequest | null;

  @ManyToOne(() => StorageUnit, { nullable: true })
  @JoinColumn({ name: 'unit_id' })
  unit!: StorageUnit | null;

  @ManyToOne(() => IotDevice, { nullable: true })
  @JoinColumn({ name: 'device_id' })
  device!: IotDevice | null;

  @Column({ type: 'bigint', nullable: true })
  sequence!: string | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  temperature!: number;

  @Column({ type: 'timestamp' })
  recorded_at!: Date;
}
