import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource, EntitySchema, QueryRunner } from 'typeorm';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../guards/auth.guard';
import { DashboardReadGuard } from '../guards/dashboard-read.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { StockAccessService } from '../guards/stock-access.service';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { InventoryAccessGrant } from '../guards/entities/inventory-access-grant.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Repository } from 'typeorm';
import { InventoryController } from '../inventory/inventory.controller';
import { InventoryService } from '../inventory/inventory.service';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalReadGuard } from '../guards/operational-read.guard';

jest.setTimeout(60000);
const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
describe('dashboard HTTP authorization and persisted PostgreSQL aggregates', () => {
  let pg: PGlite, app: INestApplication, jwt: JwtService;
  let fail = false;
  const actors = new Map<string, any>();
  const sql = async (query: string, args: any[] = []) =>
    (await pg.query(query, args)).rows as any[];
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE roles(id int PRIMARY KEY,name text);
      INSERT INTO roles VALUES (1,'PHARMACIST'),(2,'ADMIN'),(3,'SUPERADMIN'),(4,'OTHER');
      CREATE TABLE role_permissions(role_id int,permission text,UNIQUE(role_id,permission));
      INSERT INTO role_permissions VALUES (2,'admin.access'),(2,'dashboard.read'),(3,'admin.access'),(3,'dashboard.read');
      CREATE TABLE hospitals(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
      CREATE TABLE medicines(id uuid PRIMARY KEY,generic_name text,gtin text,deleted_at timestamptz);
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,quantity int,selling_unit text,
        batch_number text,expiry_date date,status text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE scan_logs(inventory_id uuid,result text,client_uuid uuid,action text,gtin text,batch_number text,serial_number text,expiry_date date);
      CREATE TABLE transfer_requests(id uuid PRIMARY KEY,from_hospital uuid,to_hospital uuid,status text,quantity int,created_at timestamptz DEFAULT now(),approved_at timestamptz,inventory_id uuid);
      CREATE TABLE storage_units(id uuid PRIMARY KEY,facility_id uuid,last_seen_at timestamptz,offline_after_seconds int,operational_state text,target_min numeric,target_max numeric);
      CREATE TABLE temperature_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),unit_id uuid,temperature numeric,recorded_at timestamptz);
      CREATE TABLE cold_chain_events(unit_id uuid,state text);
    `);
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/dashboard-access.sql'),
        'utf8',
      ),
    );
    const getRepository = (entity: unknown): any => {
      if (entity === User)
        return { findOne: async (opts: any) => actors.get(opts.where.id) };
      if (entity === RolePermission)
        return {
          findBy: async (opts: any) =>
            sql('SELECT permission FROM role_permissions WHERE role_id=$1', [
              opts.role_id,
            ]),
        };
      if (entity === VerificationApplication)
        return { findOne: async () => null };
      if (entity === InventoryAccessGrant)
        return { existsBy: async () => false };
      throw new Error('Unexpected repository');
    };
    const db = {
      getRepository,
      manager: { getRepository },
      transaction: async (_isolation: string, callback: any) => {
        if (fail) throw new Error('database unavailable');
        return pg.transaction(async (tx) =>
          callback({
            query: async (q: string, args: any[]) =>
              (await tx.query(q, args)).rows,
          }),
        );
      },
    };
    const service = new DashboardService(
      {} as any,
      { manager: db } as unknown as Repository<Inventory>,
      {} as any,
      {} as any,
    );
    // Minimal mapped schemas let the real near-expiry TypeORM query run in PostgreSQL.
    const mapped = new DataSource({
      type: 'postgres',
      entities: [
        new EntitySchema({
          name: 'WatchMedicine',
          tableName: 'medicines',
          columns: {
            id: { type: 'uuid', primary: true },
            generic_name: { type: String },
            deleted_at: {
              type: 'timestamptz',
              nullable: true,
              deleteDate: true,
            },
          },
        }),
        new EntitySchema({
          name: 'WatchHospital',
          tableName: 'hospitals',
          columns: {
            id: { type: 'uuid', primary: true },
            status: { type: String },
            deleted_at: { type: 'timestamptz', nullable: true },
          },
        }),
        new EntitySchema<Inventory>({
          name: 'WatchInventory',
          tableName: 'inventory',
          columns: {
            id: { type: 'uuid', primary: true },
            quantity: { type: Number },
            selling_unit: { type: String },
            batch_number: { type: String },
            expiry_date: { type: 'date' },
            status: { type: String },
          },
          relations: {
            medicine: {
              type: 'many-to-one',
              target: 'WatchMedicine',
              joinColumn: { name: 'medicine_id' },
            },
            hospital: {
              type: 'many-to-one',
              target: 'WatchHospital',
              joinColumn: { name: 'hospital_id' },
            },
          },
        }),
      ],
    });
    await (mapped as any).buildMetadatas();
    const runner = {
      query: async (q: string, args: any[], structured = false) => {
        if (fail) throw new Error('database unavailable');
        const records = await sql(q, args);
        return structured
          ? { records, raw: records, affected: records.length }
          : records;
      },
    } as QueryRunner;
    const watchlist = new InventoryService(
      {
        createQueryBuilder: (alias: string) =>
          mapped
            .createQueryBuilder('WatchInventory', alias, runner)
            .callListeners(false),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'dashboard-test-secret' })],
      controllers: [DashboardController, InventoryController],
      providers: [
        AuthGuard,
        DashboardReadGuard,
        NetworkAdminGuard,
        StockAccessService,
        OperationalReadGuard,
        { provide: InventoryService, useValue: watchlist },
        { provide: OperationalReadsService, useValue: {} },
        { provide: DataSource, useValue: db },
        { provide: DashboardService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(async () => {
    fail = false;
    actors.clear();
    for (const [n, role, roleId] of [
      [10, 'PHARMACIST', 1],
      [11, 'ADMIN', 2],
      [12, 'SUPERADMIN', 3],
      [13, 'OTHER', 4],
    ] as const)
      actors.set(id(n), {
        id: id(n),
        active: true,
        verification_status: 'VERIFIED',
        account_type: 'PHARMACIST',
        role: { id: roleId, name: role },
        hospital: { id: id(1), status: 'ACTIVE' },
      });
    await pg.exec(
      'TRUNCATE hospitals,medicines,inventory,scan_logs,transfer_requests,storage_units,cold_chain_events,temperature_logs',
    );
    for (const n of [1, 2]) {
      await sql("INSERT INTO hospitals VALUES ($1,'ACTIVE',NULL)", [id(n)]);
      await sql('INSERT INTO medicines VALUES ($1,$2,$3,NULL)', [
        id(20 + n),
        'Drug ' + n,
        'gtin-' + n,
      ]);
      await sql(
        "INSERT INTO inventory VALUES ($1,$2,$3,$4,'vial','LOT',CURRENT_DATE+30,'AVAILABLE',CURRENT_TIMESTAMP)",
        [id(30 + n), id(n), id(20 + n), n * 10],
      );
    }
  });
  const get = (path: string, n = 10) =>
    request(app.getHttpServer())
      .get('/api/dashboard/' + path)
      .set(
        'Authorization',
        'Bearer ' +
          jwt.sign({ id: id(n), role: 'SUPERADMIN', facilityId: id(2) }),
      );
  const near = (n = 10) =>
    request(app.getHttpServer())
      .get('/api/inventory/near-expiry?limit=7')
      .set('Authorization', 'Bearer ' + jwt.sign({ id: id(n) }));
  it('routes near-expiry correctly and refreshes only eligible authorized stock', async () => {
    const response = await near();
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      facilityId: id(1),
      qty: 10,
      unit: 'vial',
    });
    expect((await near(13)).status).toBe(403);
    await sql(
      "INSERT INTO role_permissions VALUES (2,'inventory.read') ON CONFLICT DO NOTHING",
    );
    expect((await near(11)).body.data.items).toHaveLength(2);
    await sql('UPDATE inventory SET quantity=12 WHERE id=$1', [id(31)]);
    expect((await near()).body.data.items[0].qty).toBe(12);
    await sql("UPDATE inventory SET status='DISPOSED' WHERE id=$1", [id(31)]);
    expect((await near()).body.data.items).toEqual([]);
    await sql("UPDATE inventory SET status='AVAILABLE' WHERE id=$1", [id(31)]);
    await sql('UPDATE medicines SET deleted_at=now() WHERE id=$1', [id(21)]);
    expect((await near()).body.data.items).toEqual([]);
  });
  it('isolates simultaneously signed-in facility/admin sessions and ignores supplied scope', async () => {
    const [facility, admin, superadmin] = await Promise.all([
      get('summary?facilityId=' + id(2)),
      get('summary', 11),
      get('summary', 12),
    ]);
    expect(facility.status).toBe(200);
    expect(facility.headers['cache-control']).toContain('no-store');
    expect(facility.body.data).toMatchObject({
      nodes: 1,
      totalVials: 10,
      scope: { type: 'facility', facilityId: id(1) },
      gs1AuthenticatedVials: 0,
    });
    expect(admin.body.data).toMatchObject({
      nodes: 2,
      totalVials: 30,
      scope: { type: 'network' },
    });
    expect(superadmin.body.data.totalVials).toBe(30);
    const charts = await get('charts');
    expect(charts.body.data.therapeuticStock).toEqual([
      { drug: 'Drug 1', qty: 10, unit: 'vial' },
    ]);
    expect(charts.body.data.asOf).toBeTruthy();
    expect((await get('summary')).body.data.totalVials).toBe(10);
  });
  it('denies missing grants, revoked verification, inactive memberships and network grants/MFA', async () => {
    for (const path of ['summary', 'charts'])
      expect((await get(path, 13)).status).toBe(403);
    const actor = actors.get(id(10));
    actor.verification_status = 'PENDING';
    expect((await get('summary')).status).toBe(403);
    actor.verification_status = 'VERIFIED';
    actor.hospital.status = 'SUSPENDED';
    expect((await get('summary')).status).toBe(403);
    actor.hospital.status = 'ACTIVE';
    actor.active = false;
    expect((await get('summary')).status).toBe(401);
    const admin = actors.get(id(11));
    admin.role.id = 4;
    expect((await get('summary', 11)).status).toBe(403);
    admin.role.id = 2;
    const previous = process.env.ADMIN_MFA_REQUIRED;
    process.env.ADMIN_MFA_REQUIRED = 'true';
    try {
      expect((await get('charts', 11)).status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_MFA_REQUIRED;
      else process.env.ADMIN_MFA_REQUIRED = previous;
    }
  });
  it('refreshes stock after intake, edits, qualifying scans, disposal and deletion without mixing units', async () => {
    const baseline = (await get('charts')).body.data;
    await sql(
      "INSERT INTO inventory VALUES ($1,$2,$3,10,'box','BOX',CURRENT_DATE+30,'AVAILABLE',CURRENT_TIMESTAMP)",
      [id(40), id(1), id(21)],
    );
    let summary = (await get('summary')).body.data;
    expect(summary).toMatchObject({
      totalVials: 10,
      quantitiesByUnit: { vial: 10, box: 10 },
      gs1AuthenticatedVials: 0,
    });
    expect((await get('charts')).body.data.therapeuticStock).toHaveLength(2);
    await sql('UPDATE inventory SET quantity=15 WHERE id=$1', [id(31)]);
    expect((await get('charts')).body.data.inventoryOverTime[0].vials).toBe(15);
    await sql(
      "INSERT INTO scan_logs VALUES ($1,'CLEAN',$2,'NEW','gtin-1','LOT','SERIAL',CURRENT_DATE+30)",
      [id(31), id(50)],
    );
    await sql(
      "INSERT INTO scan_logs VALUES ($1,'FLAGGED',$2,'NEW','gtin-1','LOT','SERIAL',CURRENT_DATE+30)",
      [id(31), id(51)],
    );
    expect((await get('summary')).body.data.gs1AuthenticatedVials).toBe(1);
    await sql("UPDATE inventory SET status='DISPOSED' WHERE id=$1", [id(40)]);
    expect((await get('summary')).body.data.quantitiesByUnit).toEqual({
      vial: 15,
    });
    await sql('UPDATE medicines SET deleted_at=now() WHERE id=$1', [id(21)]);
    summary = (await get('summary')).body.data;
    expect(summary.totalVials).toBe(0);
    expect(summary.gs1AuthenticatedVials).toBe(0);
    const empty = (await get('charts')).body.data;
    for (const key of [
      'inventoryOverTime',
      'drugSplit',
      'therapeuticStock',
      'redistributionEfficiency',
    ])
      expect(empty[key]).toEqual([]);
    expect((await get('summary', 11)).body.data.totalVials).toBe(20);
    expect(baseline.inventoryOverTime[0].vials).toBe(10);
  });
  it('derives risk from stock, completed redistribution from delivery, and integrity from monitored units/events', async () => {
    await sql('UPDATE inventory SET quantity=0 WHERE id=$1', [id(31)]);
    expect((await get('summary')).body.data.stockOutRiskPct).toBe(100);
    await sql(
      "INSERT INTO transfer_requests(id,from_hospital,to_hospital,status,quantity,created_at,approved_at) VALUES ($1,$2,$3,'APPROVED',3,now(),now())",
      [id(60), id(1), id(2)],
    );
    expect((await get('charts')).body.data.redistributionEfficiency).toEqual(
      [],
    );
    await sql("UPDATE transfer_requests SET status='DELIVERED'");
    expect(
      (await get('charts')).body.data.redistributionEfficiency,
    ).toHaveLength(1);
    await sql(
      "INSERT INTO storage_units VALUES ($1,$2,now(),300,'ONLINE',2,8)",
      [id(70), id(1)],
    );
    expect((await get('summary')).body.data.chainIntegrityPct).toBeNull();
    await sql(
      'INSERT INTO temperature_logs(unit_id,temperature,recorded_at) VALUES ($1,4,now())',
      [id(70)],
    );
    expect((await get('summary')).body.data.chainIntegrityPct).toBe(100);
    await sql("INSERT INTO cold_chain_events VALUES ($1,'OPEN')", [id(70)]);
    expect((await get('summary')).body.data.chainIntegrityPct).toBe(0);
    await sql("UPDATE cold_chain_events SET state='RESOLVED'");
    expect((await get('summary')).body.data.chainIntegrityPct).toBe(100);
  });
  it('returns a server error when aggregate sources are unavailable', async () => {
    fail = true;
    expect((await get('summary')).status).toBe(500);
    expect((await get('charts')).status).toBe(500);
  });
  it('keeps missing percentages unavailable and preserves recorded zeros without a fabricated region', async () => {
    await sql('DELETE FROM inventory WHERE hospital_id=$1', [id(1)]);
    const response = await get('summary');
    expect(response.body.data).toMatchObject({
      network: { region: null },
      totalVials: 0,
      nodes: 1,
      stockOutRiskPct: null,
      chainIntegrityPct: null,
    });
  });
  it('does not turn a missing recorded stock quantity into an aggregate zero', async () => {
    await sql('UPDATE inventory SET quantity=NULL WHERE id=$1', [id(31)]);
    expect((await get('summary')).body.data).toMatchObject({
      totalVials: null,
      gs1AuthenticatedVials: null,
      stockOutRiskPct: null,
      quantitiesByUnit: { vial: null },
    });
    await sql('UPDATE inventory SET quantity=0 WHERE id=$1', [id(31)]);
    expect((await get('summary')).body.data).toMatchObject({
      totalVials: 0,
      gs1AuthenticatedVials: 0,
      stockOutRiskPct: 100,
    });
  });
});
