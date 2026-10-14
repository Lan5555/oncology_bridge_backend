import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('research_inquiries')
export class ResearchInquiry {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column() organisation!: string;
  @Column() email!: string;
  @Column('text') message!: string;
  @CreateDateColumn() created_at!: Date;
}
