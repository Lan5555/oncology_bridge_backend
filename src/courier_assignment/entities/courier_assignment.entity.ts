import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Courier } from '../../courier/entities/courier.entity';
import { TransferRequest } from '../../transfer_requests/entities/transfer_request.entity';

@Entity('courier_assignments')
export class CourierAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Courier, (courier) => courier.assignments)
  @JoinColumn({ name: 'courier_id' })
  courier!: Courier;

  @ManyToOne(() => TransferRequest)
  @JoinColumn({ name: 'transfer_id' })
  transfer!: TransferRequest;

  @Column({ nullable: true })
  picked_at!: Date;

  @Column({ nullable: true })
  delivered_at!: Date;

  @Column()
  status!: string;
}
