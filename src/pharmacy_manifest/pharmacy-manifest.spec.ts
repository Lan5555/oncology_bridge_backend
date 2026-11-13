import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { DataSource, EntitySchema } from 'typeorm';
import { pgliteDataSource } from '../../test/pglite-data-source';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { StockAccessService } from '../guards/stock-access.service';
import {
  PackDispenseEvent,
  PharmacyManifest,
  PharmacyManifestPack,
} from './entities/pharmacy-manifest.entity';
import { PharmacyManifestService } from './pharmacy-manifest.service';
import { parseGs1, validateIdentifiers } from '../scan_log/gs1-parser';
import { ForbiddenException } from '@nestjs/common';
import { ManifestSpreadsheetService } from './manifest-spreadsheet.service';

jest.setTimeout(60000);
const gtin = '09506000134352';
const pack = { gtin, serial: 'S1', lot: 'B1', expiry: '2099-12-31' };
const barcode = (serial = 'S1', lot = 'B1', expiry = '991231') =>
  `(01)${gtin}(17)${expiry}(10)${lot}(21)${serial}`;

describe('GS1 manifest barcode validation', () => {
  it('interprets scanner separators and GS1 month end', () => {
    const ids = parseGs1(`]d201${gtin}1799120010B1\u001d21S1`);
    expect(ids).toEqual({ gtin, expiry: '991200', lot: 'B1', serial: 'S1' });
    expect(validateIdentifiers(ids).valid).toBe(true);
  });
  it.each([
    `${barcode()}(21)S2`,
    `${barcode()}(99)junk`,
    `(01)${gtin}99(17)991231(10)B1(21)S1`,
    barcode('S'.repeat(21)),
    barcode('S1', 'B1', '990230'),
    `01${gtin}1799123110B1\u001d21S1\u001d99junk`,
  ])('rejects malformed or ambiguous barcode %s', (raw) => {
    expect(validateIdentifiers(parseGs1(raw)).valid).toBe(false);
  });
});

describe('pharmacy manifest persistence and dispensing', () => {
  let pg: PGlite;
  let db: DataSource;
  let service: PharmacyManifestService;
  const facilityA = randomUUID(),
    facilityB = randomUUID(),
    actorA = randomUUID(),
    actorB = randomUUID();
  const access = { assertManage: jest.fn() };
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY);
      INSERT INTO hospitals VALUES ('${facilityA}'), ('${facilityB}');
      INSERT INTO users VALUES ('${actorA}'), ('${actorB}');
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id),
        action text NOT NULL, object_type text, object_id uuid, description text, ip_address text);`);
    await pg.exec(
      readFileSync(
        join(__dirname, '../../database/pharmacy-manifests.sql'),
        'utf8',
      ),
    );
    const uuid = { type: 'uuid' as const };
    const primary = { ...uuid, primary: true, generated: 'uuid' as const };
    const schemas: EntitySchema[] = [
      new EntitySchema({
        name: 'PharmacyManifest',
        target: PharmacyManifest,
        tableName: 'pharmacy_manifests',
        columns: {
          id: primary,
          facility_id: uuid,
          uploaded_by: uuid,
          reference: { type: String },
          created_at: { type: 'timestamptz', createDate: true },
        },
      }),
      new EntitySchema({
        name: 'PharmacyManifestPack',
        target: PharmacyManifestPack,
        tableName: 'pharmacy_manifest_packs',
        columns: {
          id: primary,
          manifest_id: uuid,
          facility_id: uuid,
          gtin: { type: String },
          serial: { type: String },
          lot: { type: String },
          expiry: { type: 'date' },
        },
      }),
      new EntitySchema({
        name: 'PackDispenseEvent',
        target: PackDispenseEvent,
        tableName: 'pack_dispense_events',
        columns: {
          id: primary,
          facility_id: uuid,
          actor_id: uuid,
          client_uuid: uuid,
          gtin: { type: String },
          serial: { type: String },
          lot: { type: String },
          expiry: { type: 'date' },
          accepted: { type: Boolean },
          assessment: { type: 'jsonb' },
          created_at: { type: 'timestamptz', createDate: true },
        },
      }),
      new EntitySchema({
        name: 'User',
        target: User,
        tableName: 'users',
        columns: { id: { ...uuid, primary: true } },
      }),
      new EntitySchema<AuditLog>({
        name: 'AuditLog',
        target: AuditLog,
        tableName: 'audit_logs',
        columns: {
          id: primary,
          action: { type: String },
          object_type: { type: String },
          object_id: uuid,
          description: { type: String },
          ip_address: { type: String },
        },
        relations: {
          user: {
            type: 'many-to-one',
            target: 'User',
            joinColumn: { name: 'user_id' },
          },
        },
      }),
    ];
    db = await pgliteDataSource(pg, schemas);
    service = new PharmacyManifestService(
      db,
      access as unknown as StockAccessService,
    );
  });
  beforeEach(async () => {
    await pg.exec(
      'DELETE FROM audit_logs; DELETE FROM pack_dispense_events; DELETE FROM pharmacy_manifest_packs; DELETE FROM pharmacy_manifests;',
    );
    access.assertManage.mockReset().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        hospital: { id: id === actorA ? facilityA : facilityB },
      }),
    );
  });
  afterAll(async () => {
    await pg.close();
  });
  const upload = (actor = actorA, packs = [pack], reference = 'MANIFEST-1') =>
    service.upload({ reference, packs }, actor, 'test');
  const dispense = (
    rawBarcode = barcode(),
    clientUuid = randomUUID(),
    actor = actorA,
  ) => service.dispense({ rawBarcode, clientUuid }, actor, 'test');

  it('uploads and compares a pack without consuming it on preview', async () => {
    const manifest = await upload();
    expect(await service.check(barcode(), actorA)).toMatchObject({
      manifestId: manifest.id,
      canDispense: true,
      manifestMatch: 'MATCH',
      duplicate: false,
    });
    expect(await db.getRepository(PackDispenseEvent).count()).toBe(0);
    expect((await service.findOne(manifest.id, actorA)).packs).toHaveLength(1);
    await expect(service.findOne(manifest.id, actorB)).rejects.toThrow(
      'Manifest not found',
    );
    expect(await service.list(actorB)).toEqual([]);
  });
  it('blocks missing packs, mismatched batch/expiry, and expired packs', async () => {
    await upload(actorA, [
      pack,
      { ...pack, serial: 'OLD', expiry: '2020-01-01' },
    ]);
    expect(await dispense(barcode('MISSING'))).toMatchObject({
      canDispense: false,
      reasons: ['PACK_NOT_IN_MANIFEST'],
      suspectedCounterfeit: false,
    });
    expect(await dispense(barcode('S1', 'OTHER', '991230'))).toMatchObject({
      canDispense: false,
      mismatches: ['lot', 'expiry'],
    });
    expect(await dispense(barcode('OLD', 'B1', '200101'))).toMatchObject({
      canDispense: false,
      reasons: ['PACK_EXPIRED'],
    });
    expect(
      await db.getRepository(PackDispenseEvent).countBy({ accepted: true }),
    ).toBe(0);
  });
  it('accepts once and flags a second dispensing request, including across facilities', async () => {
    await upload();
    await upload(actorB);
    expect(await dispense()).toMatchObject({
      canDispense: true,
      duplicate: false,
    });
    expect(await dispense(barcode(), randomUUID(), actorB)).toMatchObject({
      canDispense: false,
      duplicate: true,
      suspectedCounterfeit: true,
      reasons: ['SERIAL_ALREADY_DISPENSED'],
    });
    expect(
      await db.getRepository(PackDispenseEvent).countBy({ accepted: true }),
    ).toBe(1);
    expect(
      (
        await pg.query<{ action: string }>(
          'SELECT action FROM audit_logs ORDER BY action',
        )
      ).rows.map((r) => r.action),
    ).toContain('PACK_DISPENSE_BLOCKED');
  });
  it('replays the same request, and rejects changed contents or actor', async () => {
    await upload();
    const key = randomUUID();
    const first = await dispense(barcode(), key);
    expect(await dispense(barcode(), key)).toMatchObject({
      id: first.id,
      canDispense: true,
      replay: true,
    });
    await expect(dispense(barcode('OTHER'), key)).rejects.toThrow(
      'different dispensing request',
    );
    access.assertManage.mockResolvedValue({
      id: actorB,
      hospital: { id: facilityA },
    });
    await expect(dispense(barcode(), key, actorB)).rejects.toThrow(
      'different dispensing request',
    );
    expect(await db.getRepository(PackDispenseEvent).count()).toBe(1);
  });
  it('rolls back an entire upload on existing serial conflicts', async () => {
    await upload();
    await expect(
      upload(actorA, [{ ...pack, serial: 'NEW' }, pack], 'MANIFEST-2'),
    ).rejects.toThrow('already uploaded');
    expect(await db.getRepository(PharmacyManifest).count()).toBe(1);
    expect(await db.getRepository(PharmacyManifestPack).count()).toBe(1);
  });
  it('rejects duplicate rows before saving', async () => {
    await expect(upload(actorA, [pack, pack])).rejects.toThrow('duplicate');
    expect(await db.getRepository(PharmacyManifest).count()).toBe(0);
  });
  it('allows the same serial for different GTINs', async () => {
    const other = { ...pack, gtin: '00012345600012' };
    await upload(actorA, [pack, other]);
    expect(await dispense()).toMatchObject({ canDispense: true });
    expect(await dispense(barcode().replace(gtin, other.gtin))).toMatchObject({
      canDispense: true,
      duplicate: false,
    });
  });
  it('accepts only once when two dispensing requests are submitted together', async () => {
    await upload();
    const results = await Promise.all([dispense(), dispense()]);
    expect(results.filter((result) => result.canDispense)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
  });
  it('enforces the unique accepted identity in the database itself', async () => {
    await upload();
    await dispense();
    await expect(
      pg.query(`INSERT INTO pack_dispense_events
      (facility_id, actor_id, client_uuid, gtin, serial, lot, expiry, accepted, assessment)
      SELECT facility_id, actor_id, gen_random_uuid(), gtin, serial, lot, expiry, accepted, assessment
      FROM pack_dispense_events`),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('never uses another facility manifest', async () => {
    await upload(actorB);
    expect(await dispense()).toMatchObject({
      canDispense: false,
      manifestMatch: 'NOT_FOUND',
    });
  });
  it('rolls back dispensing when its audit write fails', async () => {
    await upload();
    await pg.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT fail_dispense CHECK (action <> 'PACK_DISPENSE_ACCEPTED')",
    );
    try {
      await expect(dispense()).rejects.toThrow();
      expect(await db.getRepository(PackDispenseEvent).count()).toBe(0);
    } finally {
      await pg.exec('ALTER TABLE audit_logs DROP CONSTRAINT fail_dispense');
    }
  });
  it('requires stock permission for writes and reads', async () => {
    access.assertManage.mockRejectedValue(
      new ForbiddenException('Permission denied'),
    );
    await expect(upload()).rejects.toThrow('Permission denied');
    await expect(dispense()).rejects.toThrow('Permission denied');
    await expect(service.check(barcode(), actorA)).rejects.toThrow(
      'Permission denied',
    );
  });
  it('previews every issue without saving, with real row counts and row numbers', async () => {
    const spreadsheet = new ManifestSpreadsheetService();
    const parsed = await spreadsheet.parse({
      originalname: 'delivery.csv',
      buffer: Buffer.from(
        `gtin,lot,serial,expiry\n${gtin},B1,S1,2099-12-31\n${gtin},B1,,2099-12-31`,
      ),
    });
    const preview = await service.preview(parsed, 'REF', actorA);
    expect(preview).toMatchObject({
      canImport: false,
      totalRows: 2,
      validRows: 1,
      packs: [],
    });
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, code: 'SERIAL_REQUIRED' }),
      ]),
    );
    expect(await db.getRepository(PharmacyManifest).count()).toBe(0);
    expect(await db.getRepository(PackDispenseEvent).count()).toBe(0);
    expect((await pg.query('SELECT * FROM audit_logs')).rows).toHaveLength(0);
  });
  it('returns only normalized pack fields for a valid preview, scoped to the pharmacy', async () => {
    await upload(actorB);
    const parsed = { packs: [pack], rowNumbers: [5], totalRows: 1, issues: [] };
    expect(await service.preview(parsed, 'MANIFEST-1', actorA)).toMatchObject({
      canImport: true,
      totalRows: 1,
      validRows: 1,
      packs: [pack],
      issues: [],
    });
    const conflicting = await service.preview(parsed, 'MANIFEST-1', actorB);
    expect(conflicting).toMatchObject({ canImport: false, packs: [] });
    expect(conflicting.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 0, code: 'REFERENCE_ALREADY_EXISTS' }),
        expect.objectContaining({ row: 5, code: 'PACK_ALREADY_IMPORTED' }),
      ]),
    );
  });
  it('revalidates a successful preview when a concurrent save introduces a conflict', async () => {
    const parsed = { packs: [pack], rowNumbers: [2], totalRows: 1, issues: [] };
    expect((await service.preview(parsed, 'NEW', actorA)).canImport).toBe(true);
    await upload();
    await expect(upload(actorA, [pack], 'NEW')).rejects.toMatchObject({
      status: 409,
      response: {
        data: {
          issues: [
            expect.objectContaining({
              row: 1,
              field: 'serial',
              code: 'PACK_ALREADY_IMPORTED',
            }),
          ],
        },
      },
    });
    expect(await db.getRepository(PharmacyManifest).count()).toBe(1);
  });
  it('accepts only one of two concurrent saves without partial rows', async () => {
    const results = await Promise.allSettled([
      upload(actorA, [pack], 'ONE'),
      upload(actorA, [pack], 'TWO'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({
      reason: {
        status: 409,
        response: {
          data: {
            issues: [
              expect.objectContaining({ code: 'PACK_ALREADY_IMPORTED' }),
            ],
          },
        },
      },
    });
    expect(await db.getRepository(PharmacyManifestPack).count()).toBe(1);
    expect(await db.getRepository(PharmacyManifest).count()).toBe(1);
  });
  it('rolls back manifest and packs if the audit cannot be saved', async () => {
    await pg.exec(
      "ALTER TABLE audit_logs ADD CONSTRAINT fail_import CHECK (action <> 'PHARMACY_MANIFEST_UPLOADED')",
    );
    try {
      await expect(upload()).rejects.toMatchObject({ status: 500 });
      expect(await db.getRepository(PharmacyManifestPack).count()).toBe(0);
      expect(await db.getRepository(PharmacyManifest).count()).toBe(0);
    } finally {
      await pg.exec('ALTER TABLE audit_logs DROP CONSTRAINT fail_import');
    }
  });
  it('revalidates all fields within the save transaction for callers outside the HTTP pipe', async () => {
    await expect(
      upload(actorA, [{ ...pack, serial: '' }]),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        data: {
          issues: [
            expect.objectContaining({ row: 1, code: 'SERIAL_REQUIRED' }),
          ],
        },
      },
    });
    expect(await db.getRepository(PharmacyManifest).count()).toBe(0);
  });
  it('saves the full 1000-row limit and reports every later pack conflict', async () => {
    const packs = Array.from({ length: 1000 }, (_, index) => ({
      ...pack,
      serial: `S${index}`,
    }));
    expect(await upload(actorA, packs, 'FULL')).toMatchObject({
      reference: 'FULL',
      packCount: 1000,
    });
    const preview = await service.preview(
      {
        packs,
        rowNumbers: packs.map((_, index) => index + 2),
        totalRows: 1000,
        issues: [],
      },
      'OTHER',
      actorA,
    );
    expect(preview).toMatchObject({
      canImport: false,
      totalRows: 1000,
      validRows: 0,
      packs: [],
    });
    expect(preview.issues).toHaveLength(1000);
    expect(preview.issues[999]).toMatchObject({
      row: 1001,
      code: 'PACK_ALREADY_IMPORTED',
    });
  });
  it('looks up saved deliveries by exact reference only at the authenticated pharmacy', async () => {
    await upload(actorA, [pack], 'EXACT');
    expect(await service.list(actorA, 'EXACT')).toHaveLength(1);
    expect(await service.list(actorA, 'EXAC')).toEqual([]);
    expect(await service.list(actorB, 'EXACT')).toEqual([]);
  });
});
