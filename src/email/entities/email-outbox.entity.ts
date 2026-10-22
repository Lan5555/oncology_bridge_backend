import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('email_outbox')
export class EmailOutbox {
  @PrimaryGeneratedColumn('uuid') id!: string;
  // Encrypt recipients and content, including password reset links, at rest.
  @Column('text', { nullable: true }) payload!: string | null;
  @Column({ type: 'varchar', length: 16, default: 'PENDING' }) status!: string;
  @Column({ default: 0 }) attempts!: number;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  available_at!: Date;
  @Column({ type: 'timestamptz', nullable: true }) expires_at!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) sent_at!: Date | null;
  @Column({ type: 'varchar', nullable: true }) message_id!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
