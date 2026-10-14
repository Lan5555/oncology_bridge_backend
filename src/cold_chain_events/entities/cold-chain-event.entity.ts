import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StorageUnit } from '../../storage_units/entities/storage-unit.entity';

@Entity('cold_chain_events')
export class ColdChainEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => StorageUnit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit!: StorageUnit;
  @Column() severity!: string;
  @Column('text') message!: string;
  @Column('text', { nullable: true }) action_taken!: string | null;
  @Column({ default: 'OPEN' }) state!: string;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  at!: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolved_at!: Date | null;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  last_seen_at!: Date;
  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  observed_min_celsius!: number | null;
  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  observed_max_celsius!: number | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  affected_inventory_ids!: string[];
}
