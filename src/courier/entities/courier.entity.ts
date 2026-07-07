import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { CourierAssignment } from '../../courier_assignment/entities/courier_assignment.entity';

@Entity('couriers')
export class Courier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  phone!: string;

  @Column()
  company!: string;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @OneToMany(() => CourierAssignment, (assignment) => assignment.courier)
  assignments!: CourierAssignment[];
}
