import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('webhook_logs')
export class WebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  provider!: string;

  @Column()
  endpoint!: string;

  @Column({
    type: 'jsonb',
  })
  payload!: Record<string, any>;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  response!: Record<string, any>;

  @Column()
  status_code!: number;

  @CreateDateColumn()
  created_at!: Date;
}
