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

  @Column()
  password_hash!: string;

  @Column({ nullable: true })
  device_id!: string;

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
