import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Inventory } from '../../inventory/entities/inventory.entity';
@Entity('medicines')
export class Medicine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  gtin!: string;

  @Column()
  generic_name!: string;

  @Column()
  brand_name!: string;

  @Column()
  manufacturer!: string;

  @Column()
  strength!: string;

  @Column()
  dosage_form!: string;

  @Column()
  storage_temperature!: string;

  @CreateDateColumn()
  created_at!: Date;

  @OneToMany(() => Inventory, (inventory) => inventory.medicine)
  inventory!: Inventory[];
}
