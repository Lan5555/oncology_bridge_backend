import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('integration_configurations')
export class IntegrationConfiguration {
  @PrimaryColumn({ length: 48 }) integration_key!: string;
  @Column({ name: 'config_values', type: 'jsonb', default: () => "'{}'::jsonb" }) values!: Record<string, unknown>;
  @Column('uuid', { nullable: true }) updated_by!: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
  @Column({ type: 'timestamptz', nullable: true }) last_checked_at!: Date | null;
  @Column({ type: 'varchar', length: 24, nullable: true }) last_status!: string | null;
}
