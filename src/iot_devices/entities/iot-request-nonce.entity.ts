import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('iot_request_nonces')
@Unique(['device_id', 'nonce'])
export class IotRequestNonce {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') device_id!: string;
  @Column({ length: 160 }) nonce!: string;
  @Column({ type: 'timestamptz' }) expires_at!: Date;
  @CreateDateColumn() created_at!: Date;
}
