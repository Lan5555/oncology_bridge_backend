import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('facility_license_checks')
export class FacilityLicenseCheck {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') membership_request_id!: string;
  @Column('uuid') facility_id!: string;
  @Column('uuid') user_id!: string;
  @Column('uuid') application_id!: string;
  @Column('uuid') checked_by!: string;
  @Column({ length: 32 }) registry!: string;
  @Column({ length: 24 }) result!: string;
  @Column('text') evidence!: string;
  @CreateDateColumn({ type: 'timestamptz' }) checked_at!: Date;
}
