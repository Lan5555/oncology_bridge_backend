import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('facility_membership_requests')
export class FacilityMembershipRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') user_id!: string;
  @Column('uuid') facility_id!: string;
  @Column({ type: 'varchar', length: 24, default: 'PENDING' }) status!: string;
  @Column('uuid', { nullable: true }) reviewer_id!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewed_at!: Date | null;
  @Column('text', { nullable: true }) reason!: string | null;
  @CreateDateColumn() submitted_at!: Date;
}
