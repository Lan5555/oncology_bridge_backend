import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('password_resets')
export class PasswordReset {
  @PrimaryColumn({ type: 'varchar', length: 64 }) token_hash!: string;
  @Column('uuid') user_id!: string;
  @Column('timestamptz') expires_at!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
