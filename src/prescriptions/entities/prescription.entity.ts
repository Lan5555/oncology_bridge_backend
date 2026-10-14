import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('prescriptions')
export class Prescription {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) display_id!: string;
  @Column() patient_ref!: string;
  @Column() icd10!: string;
  @Column({ nullable: true }) tnm_stage!: string;
  @Column('uuid') drug_id!: string;
  @Column('int') qty!: number;
  @Column({ nullable: true }) insurer!: string;
  @Column('uuid') pharmacy_facility_id!: string;
  @Column({ default: 'Pending' }) auth_status!: string;
  @Column({ default: 'Waiting' }) order_stage!: string;
  @Column('uuid') prescriber_id!: string;
  @CreateDateColumn() created_at!: Date;
  @UpdateDateColumn() updated_at!: Date;
}
