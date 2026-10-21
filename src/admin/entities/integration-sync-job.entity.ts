import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('integration_sync_jobs')
export class IntegrationSyncJob {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ length: 48 }) integration_key!: string;
  @Column({ length: 24, default: 'QUEUED' }) status!: string;
  @Column('uuid') started_by!: string;
  @Column({ type: 'text', nullable: true }) started_ip!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) started_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
  @Column({ type: 'timestamptz', nullable: true }) finished_at!: Date | null;
  @Column('text', { nullable: true }) safe_summary!: string | null;
}
