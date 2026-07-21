import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Inventory } from '../../inventory/entities/inventory.entity';

export enum FacilityStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}
export enum FacilityType {
  HOSPITAL = 'HOSPITAL',
  CANCER_CENTER = 'CANCER_CENTER',
  CLINIC = 'CLINIC',
  PHARMACY = 'PHARMACY',
}

@Entity('hospitals')
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({
    type: 'enum',
    enum: FacilityType,
  })
  facility_type!: FacilityType;

  @Column({ unique: true })
  hospital_code!: string;

  @Column()
  address!: string;

  @Column()
  city!: string;

  @Column()
  state!: string;

  @Column('decimal', {
    precision: 10,
    scale: 7,
    nullable: true,
  })
  latitude?: number;

  @Column('decimal', {
    precision: 10,
    scale: 7,
    nullable: true,
  })
  longitude?: number;

  @Column({ unique: true })
  phone!: string;

  @Column({ unique: true })
  email!: string;

  @Column({
    type: 'varchar',
    length: 64,
    unique: true,
  })
  email_hash!: string;

  @Column({
    type: 'varchar',
    length: 64,
    unique: true,
  })
  phone_hash!: string;

  @Column({
    type: 'enum',
    enum: FacilityStatus,
    default: FacilityStatus.PENDING,
  })
  status!: FacilityStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @OneToMany(() => User, (user) => user.hospital)
  users!: User[];

  @OneToMany(() => Inventory, (inventory) => inventory.hospital)
  inventory!: Inventory[];
}
