import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('facility_devices')
export class FacilityDevice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') facility_id!: string;
  @Column() device_id!: string;
  @Column({ nullable: true }) label!: string;
  @Column({ default: false }) approved!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) last_seen!: Date | null;
}
