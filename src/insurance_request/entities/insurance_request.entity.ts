import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { InsuranceProvider } from '../../insurance_provider/entities/insurance_provider.entity';
import { TransferRequest } from '../../transfer_requests/entities/transfer_request.entity';

@Entity('insurance_requests')
export class InsuranceRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TransferRequest)
  @JoinColumn({ name: 'transfer_id' })
  transfer!: TransferRequest;

  @ManyToOne(() => InsuranceProvider, (provider) => provider.requests)
  @JoinColumn({ name: 'provider_id' })
  provider!: InsuranceProvider;

  @Column({ nullable: true })
  authorization_code!: string;

  @Column()
  status!: string;

  @Column('text', { nullable: true })
  response!: string;

  @CreateDateColumn()
  created_at!: Date;
}
