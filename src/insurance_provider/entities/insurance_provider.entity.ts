import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { InsuranceRequest } from '../../insurance_request/entities/insurance_request.entity';

@Entity('insurance_providers')
export class InsuranceProvider {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  api_url!: string;

  @Column()
  auth_type!: string;

  @Column({ default: true })
  active!: boolean;

  @OneToMany(() => InsuranceRequest, (request) => request.provider)
  requests!: InsuranceRequest[];
}
