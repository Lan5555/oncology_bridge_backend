import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('storage_units')
export class StorageUnit {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') facility_id!: string;
  @Column() label!: string;
  @Column({ default: 'FRIDGE' }) kind!: string;
  @Column('decimal', { precision: 4, scale: 2 })
  target_min!: number;
  @Column('decimal', { precision: 4, scale: 2 })
  target_max!: number;
  // Kept nullable for legacy rows. Device credentials live in iot_devices and
  // are resolved from server-side secret configuration, never returned by API.
  @Column({ type: 'varchar', unique: true, nullable: true, select: false })
  device_key!: string | null;
  @Column({ type: 'int', default: 300 }) offline_after_seconds!: number;
  @Column({ default: 'UNKNOWN' }) operational_state!: string;
  @Column({ type: 'timestamptz', nullable: true }) last_seen_at!: Date | null;
  @CreateDateColumn() created_at!: Date;
}
