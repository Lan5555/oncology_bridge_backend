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

@Entity('hospitals')
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

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
  latitude!: number;

  @Column('decimal', {
    precision: 10,
    scale: 7,
    nullable: true,
  })
  longitude!: number;

  @Column()
  phone!: string;

  @Column()
  email!: string;

  @Column({ default: false })
  verified!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @OneToMany(() => User, (user) => user.hospital)
  users!: User[];

  @OneToMany(() => Inventory, (inventory) => inventory.hospital)
  inventory!: Inventory[];
}
