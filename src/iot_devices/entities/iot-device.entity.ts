import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Hospital } from '../../hospital/entities/hospital.entity';
import { IotDeviceUnit } from './iot-device-unit.entity';

@Entity('iot_devices')
export class IotDevice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) device_id!: string;
  @ManyToOne(() => Hospital, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'facility_id' })
  facility!: Hospital;
  @Column('uuid') facility_id!: string;
  @Column() secret_ref!: string;
  @Column({ type: 'varchar', length: 64 }) secret_fingerprint!: string;
  @Column({ default: true }) active!: boolean;
  @Column({ type: 'int', default: 300 }) expected_interval_seconds!: number;
  @Column('decimal', { precision: 5, scale: 2, default: -40 })
  sensor_min_celsius!: number;
  @Column('decimal', { precision: 5, scale: 2, default: 85 })
  sensor_max_celsius!: number;
  @Column({ type: 'timestamptz', nullable: true }) revoked_at!: Date | null;
  @CreateDateColumn() created_at!: Date;
  @OneToMany(() => IotDeviceUnit, (assignment) => assignment.device)
  units!: IotDeviceUnit[];
}
