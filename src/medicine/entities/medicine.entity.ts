import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  DeleteDateColumn,
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

  @Column({ default: true })
  prescription_required!: boolean;

  @Column({ type: 'uuid', nullable: true })
  catalog_facility_id!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at!: Date | null;

  @OneToMany(() => Inventory, (inventory) => inventory.medicine)
  inventory!: Inventory[];
}
