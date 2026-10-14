import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Role } from './role.entity';

@Entity('role_permissions')
@Unique(['role_id', 'permission'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('int') role_id!: number;
  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;
  @Column() permission!: string;
}
