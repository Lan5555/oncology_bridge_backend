import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('pharmacy_manifests')
@Index(['facility_id', 'reference'], { unique: true })
export class PharmacyManifest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') facility_id!: string;
  @Column('uuid') uploaded_by!: string;
  @Column({ length: 120 }) reference!: string;
  @CreateDateColumn() created_at!: Date;
}

@Entity('pharmacy_manifest_packs')
@Index(['facility_id', 'gtin', 'serial'], { unique: true })
export class PharmacyManifestPack {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') manifest_id!: string;
  @Column('uuid') facility_id!: string;
  @Column({ length: 14 }) gtin!: string;
  @Column({ length: 20 }) serial!: string;
  @Column({ length: 20 }) lot!: string;
  @Column('date') expiry!: string;
}

export interface PackAssessment {
  identifiers: { gtin: string; serial: string; lot: string; expiry: string };
  manifestId: string | null;
  manifestMatch: 'MATCH' | 'NOT_FOUND' | 'MISMATCH';
  mismatches: string[];
  duplicate: boolean;
  suspectedCounterfeit: boolean;
  canDispense: boolean;
  reasons: string[];
  authenticity: 'UNVERIFIED';
}

@Entity('pack_dispense_events')
@Index(['facility_id', 'client_uuid'], { unique: true })
@Index('uq_pack_dispense_identity', ['gtin', 'serial'], {
  unique: true,
  where: 'accepted = true',
})
export class PackDispenseEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') facility_id!: string;
  @Column('uuid') actor_id!: string;
  @Column('uuid') client_uuid!: string;
  @Column({ length: 14 }) gtin!: string;
  @Column({ length: 20 }) serial!: string;
  @Column({ length: 20 }) lot!: string;
  @Column('date') expiry!: string;
  @Column() accepted!: boolean;
  @Column('jsonb') assessment!: PackAssessment;
  @CreateDateColumn() created_at!: Date;
}
