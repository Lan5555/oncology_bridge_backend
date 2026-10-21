import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('verification_applications')
export class VerificationApplication {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') user_id!: string;
  @Column() registry!: string;
  @Column() license_number!: string;
  @Column({ default: 'UNAVAILABLE' }) registry_result!: string;
  @Column({ default: 'PENDING' }) status!: string;
  @Column('uuid', { nullable: true }) reviewer_id!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewed_at!: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  last_checked_at!: Date | null;
  @Column('text', { nullable: true }) reason!: string | null;
  @CreateDateColumn() submitted_at!: Date;
}
