import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 120 }) key!: string;
  @Column({ type: 'jsonb', default: () => "'null'::jsonb" }) value!: unknown;
  @UpdateDateColumn() updated_at!: Date;
}
