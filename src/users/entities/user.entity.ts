import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../role/entities/role.entity';
import { Hospital } from '../../hospital/entities/hospital.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Role, (role) => role.users)
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @ManyToOne(() => Hospital, (hospital) => hospital.users)
  @JoinColumn({ name: 'hospital_id' })
  hospital!: Hospital;

  @Column()
  first_name!: string;

  @Column()
  last_name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  phone!: string;

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

  @Column()
  password_hash!: string;

  @Column({ nullable: true })
  device_id!: string;

  @Column({ type: 'varchar', length: 24, nullable: true, unique: true })
  license_number!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  license_registry!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'MANUAL_REVIEW' })
  verification_status!: string;

  @Column({ type: 'varchar', length: 24, default: 'UNAVAILABLE' })
  registry_result!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  account_type!: string | null;

  @Column({ nullable: true })
  allowed_ip!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ nullable: true })
  last_login!: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
