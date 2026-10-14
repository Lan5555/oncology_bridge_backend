import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('cold_chain_outbox')
export class ColdChainOutbox {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({
    type: 'bigint',
    unique: true,
    default: () => "nextval('cold_chain_outbox_stream_id_seq')",
  })
  stream_id!: string;
  @Column() event_type!: string;
  @Column('uuid') unit_id!: string;
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @Column({ default: false }) processed!: boolean;
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column('text', { nullable: true }) last_error!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) processed_at!: Date | null;
  @CreateDateColumn() created_at!: Date;
}
