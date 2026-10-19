import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('inventory_access_grants')
@Unique(['user_id', 'facility_id'])
export class InventoryAccessGrant {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') user_id!: string;
  @Column('uuid') facility_id!: string;
  @Column('uuid') granted_by!: string;
  @CreateDateColumn() created_at!: Date;
}
