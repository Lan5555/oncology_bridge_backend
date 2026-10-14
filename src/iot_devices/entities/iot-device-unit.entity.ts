import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { IotDevice } from './iot-device.entity';
import { StorageUnit } from '../../storage_units/entities/storage-unit.entity';

@Entity('iot_device_units')
@Unique(['device', 'unit'])
export class IotDeviceUnit {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => IotDevice, (device) => device.units, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device!: IotDevice;
  @ManyToOne(() => StorageUnit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit!: StorageUnit;
}
