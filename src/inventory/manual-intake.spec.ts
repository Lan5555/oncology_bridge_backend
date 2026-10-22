import { transactionQueryBuilder } from '../../test/typeorm-query-builder';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { InventoryController } from './inventory.controller';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadGuard } from '../guards/operational-read.guard';
import { DashboardReadGuard } from '../guards/dashboard-read.guard';
import { InventoryManagementGuard } from '../guards/inventory-management.guard';
import { NetResponseFilter } from '../helpers/net-response.filter';
import { PGlite } from '@electric-sql/pglite';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { InventoryService } from './inventory.service';
import { Inventory } from './entities/inventory.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { InventoryAccessGrant } from '../guards/entities/inventory-access-grant.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { ManualInventoryIntakeDto } from './dto/manual-inventory-intake.dto';
import { OperationalReadsService } from '../operations/operational-reads.service';

jest.setTimeout(60000);
const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
describe('manual intake with persisted PostgreSQL catalogue links', () => {
  let pg: PGlite, service: InventoryService, reads: OperationalReadsService;
  let permissions: string[], verified: boolean;
  let stockAccess: StockAccessService;
  const dto = () => ({
    medicineId: id(3),
    batchNumber: 'LOT-1',
    expiry: '2027-12-31',
    quantity: 10,
    unit: 'box',
    facilityId: id(1),
  });
  const actor = () => ({
    id: id(9),
    active: true,
    verification_status: verified ? 'VERIFIED' : 'PENDING',
    role: { id: 1, name: 'PHARMACIST' },
    hospital: { id: id(1), name: 'Alpha', status: 'ACTIVE' },
  });
  beforeAll(async () => {
    pg = new PGlite();
  });
  afterAll(async () => {
    await pg.close();
  });
  beforeEach(async () => {
    permissions = ['inventory.manage'];
    verified = true;
    await pg.exec(`DROP TABLE IF EXISTS marketplace_listings,marketplace_orders,transfer_requests,inventory,medicines,hospitals,audit_logs;
      CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,state text,status text);
      CREATE TABLE medicines(id uuid PRIMARY KEY,gtin text,generic_name text,brand_name text,strength text,dosage_form text,manufacturer text,
        storage_temperature text,prescription_required boolean,catalog_facility_id uuid,created_at timestamptz,deleted_at timestamptz);
      CREATE TABLE inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hospital_id uuid,medicine_id uuid REFERENCES medicines(id),batch_number text,
        serial_number text,expiry_date date,quantity int,selling_unit text,status text,storage_unit_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE audit_logs(description text);
      CREATE TABLE marketplace_listings(id uuid PRIMARY KEY,inventory_item_id uuid);
      CREATE TABLE marketplace_orders(inventory_item_id uuid,quantity int,reservation_state text,expires_at timestamptz);
      CREATE TABLE transfer_requests(id uuid,inventory_id uuid,quantity int,status text);
    `);
    await pg.query(
      "INSERT INTO hospitals VALUES ($1,'Alpha','Lagos','Lagos','ACTIVE')",
      [id(1)],
    );
    for (const n of [3, 4, 5, 6])
      await pg.query(
        `INSERT INTO medicines(id,gtin,generic_name,brand_name,strength,dosage_form,catalog_facility_id,deleted_at)
      VALUES ($1,$2,'Same generic',$3,$4,'vial',$5,$6)`,
        [
          id(n),
          'gtin-' + n,
          'Brand ' + n,
          n + ' mg',
          n === 5 ? id(2) : id(1),
          n === 6 ? '2026-01-01' : null,
        ],
      );
    const makeManager = (tx: any): any => ({
      createQueryBuilder: () =>
        transactionQueryBuilder(
          async (sql, parameters) => (await tx.query(sql, parameters)).rows,
        ),
      query: async (sql: string, args: any[]) =>
        (await tx.query(sql, args)).rows,
      getRepository: (entity: any): any => {
        if (entity === User) return { findOne: async () => actor() };
        if (entity === RolePermission)
          return {
            findBy: async () =>
              permissions.map((permission) => ({ permission })),
          };
        if (entity === VerificationApplication)
          return { findOne: async () => ({ status: 'VERIFIED' }) };
        if (entity === InventoryAccessGrant)
          return { existsBy: async () => false };
        if (entity === Hospital)
          return {
            findOne: async () =>
              (
                await tx.query(
                  'SELECT * FROM hospitals WHERE id=$1 FOR UPDATE',
                  [id(1)],
                )
              ).rows[0],
          };
        if (entity === Medicine)
          return {
            createQueryBuilder: () => {
              const clauses: string[] = [];
              const params: any = {};
              const qb: any = {
                where: (sql: string, p: any) => {
                  clauses.push(sql);
                  Object.assign(params, p);
                  return qb;
                },
                andWhere: (sql: string, p: any) => {
                  clauses.push(sql);
                  Object.assign(params, p);
                  return qb;
                },
                setLock: () => qb,
                getOne: async () =>
                  (
                    await tx.query(
                      'SELECT m.* FROM medicines m WHERE ' +
                        clauses
                          .join(' AND ')
                          .replaceAll(':medicineId', '$1')
                          .replaceAll(':facilityId', '$2'),
                      [params.medicineId, params.facilityId],
                    )
                  ).rows[0],
              };
              return qb;
            },
          };
        if (entity === AuditLog)
          return {
            save: async (row: any) =>
              tx.query('INSERT INTO audit_logs VALUES ($1)', [row.description]),
          };
        if (entity === Inventory)
          return {
            createQueryBuilder: () => {
              let selected: string;
              const qb: any = {
                withDeleted: () => qb,
                leftJoinAndSelect: () => qb,
                where: (_sql: string, params: any) => {
                  selected = params.id;
                  return qb;
                },
                setLock: () => qb,
                getOne: async () => {
                  const row = (
                    await tx.query(
                      'SELECT * FROM inventory WHERE id=$1 FOR UPDATE',
                      [selected],
                    )
                  ).rows[0];
                  return row
                    ? {
                        ...row,
                        hospital: { id: row.hospital_id },
                        medicine: { id: row.medicine_id },
                      }
                    : null;
                },
              };
              return qb;
            },
            create: (row: any) => row,
            exists: async ({ where }: any) =>
              (
                await tx.query(
                  'SELECT 1 FROM inventory WHERE hospital_id=$1 AND medicine_id=$2 AND batch_number=$3',
                  [where.hospital.id, where.medicine.id, where.batch_number],
                )
              ).rows.length > 0,
            save: async (row: any) =>
              row.id
                ? {
                    ...row,
                    ...(
                      await tx.query(
                        'UPDATE inventory SET selling_unit=$2,quantity=$3 WHERE id=$1 RETURNING *',
                        [row.id, row.selling_unit, row.quantity],
                      )
                    ).rows[0],
                  }
                : {
                    ...row,
                    ...(
                      await tx.query(
                        `INSERT INTO inventory(hospital_id,medicine_id,batch_number,serial_number,expiry_date,quantity,selling_unit,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                        [
                          row.hospital.id,
                          row.medicine.id,
                          row.batch_number,
                          row.serial_number,
                          row.expiry_date,
                          row.quantity,
                          row.selling_unit,
                          row.status,
                        ],
                      )
                    ).rows[0],
                  },
          };
        throw new Error('Unexpected entity');
      },
    });
    const db: any = {
      manager: makeManager(pg),
      getRepository: (entity: any) => makeManager(pg).getRepository(entity),
      transaction: (arg: any, callback?: any) =>
        pg.transaction((tx) => (callback ?? arg)(makeManager(tx))),
    };
    const stock = new StockAccessService(db as DataSource);
    stockAccess = stock;
    service = new InventoryService(
      { manager: db } as Repository<Inventory>,
      {} as Repository<Hospital>,
      {} as Repository<Medicine>,
      stock,
    );
    reads = new OperationalReadsService(db as DataSource);
  });
  it('returns the exact approved storage requirement in creation and refreshed inventory, without defaults', async () => {
    const approved =
      '  Refrigerate at 2?8?C.\nProtect from light; do not freeze.  ';
    await pg.query('UPDATE medicines SET storage_temperature=$1 WHERE id=$2', [
      approved,
      id(3),
    ]);
    const created = await service.create(dto(), id(9));
    expect(created.data?.medicine.storage_temperature).toBe(approved);
    const refreshed = await reads.list('inventory', id(9), {
      page: 1,
      limit: 100,
      withinDays: 60,
    });
    expect((refreshed.data?.items[0].medicine as any).storage_temperature).toBe(
      approved,
    );
    const missing = await service.create(
      { ...dto(), medicineId: id(4) },
      id(9),
    );
    expect(missing.data?.medicine.storage_temperature).toBeNull();
  });
  it('persists exact IDs for identical generic names; refresh returns linked details and audit', async () => {
    for (const medicineId of [id(3), id(4)])
      await service.create({ ...dto(), medicineId }, id(9));
    const stored = (
      await pg.query(
        'SELECT medicine_id,quantity FROM inventory ORDER BY medicine_id',
      )
    ).rows;
    expect(stored).toEqual([
      { medicine_id: id(3), quantity: 10 },
      { medicine_id: id(4), quantity: 10 },
    ]);
    const refreshed = await reads.list('inventory', id(9), {
      page: 1,
      limit: 100,
      withinDays: 60,
    });
    expect(refreshed.data?.items).toHaveLength(2);
    expect(refreshed.data?.items[0]).toMatchObject({
      medicine: { generic_name: 'Same generic', id: expect.any(String) },
      drug: 'Same generic',
      lot: 'LOT-1',
      qty: 10,
      unit: 'box',
      expiry: new Date('2027-12-31'),
    });
    const audits = (
      await pg.query<{ description: string }>('SELECT * FROM audit_logs')
    ).rows;
    expect(JSON.parse(String(audits[0].description))).toMatchObject({
      actorId: id(9),
      facilityId: id(1),
      medicineId: id(3),
      inventoryId: expect.any(String),
      batchNumber: 'LOT-1',
    });
  });
  it.each([5, 6, 99])(
    'rejects inaccessible, deleted or unknown medicine %s',
    async (n) => {
      await expect(
        service.create({ ...dto(), medicineId: id(n) }, id(9)),
      ).rejects.toMatchObject({ status: 404 });
      expect((await pg.query('SELECT * FROM inventory')).rows).toHaveLength(0);
    },
  );
  it('rejects duplicates without incrementing, including whitespace retries', async () => {
    await service.create(dto(), id(9));
    await expect(
      service.create({ ...dto(), batchNumber: ' LOT-1 ' }, id(9)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
      { quantity: 10 },
    ]);
  });
  it('requires inventory.manage and approved membership, even with medicine.update', async () => {
    permissions = ['medicine.update'];
    await expect(service.create(dto(), id(9))).rejects.toMatchObject({
      status: 403,
    });
    permissions = ['inventory.manage'];
    verified = false;
    await expect(service.create(dto(), id(9))).rejects.toMatchObject({
      status: 403,
    });
  });
  it.each(['facilityId', 'hospitalId'])(
    'rejects cross-facility %s',
    async (field) => {
      await expect(
        service.create({ ...dto(), [field]: id(2) }, id(9)),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it('uses the same catalogue policy for intake and paginated dropdown reads', async () => {
    const query = { page: 1, limit: 1, withinDays: 60 };
    const first = await reads.list('medicines', id(9), query);
    const second = await reads.list('medicines', id(9), { ...query, page: 2 });
    expect(first.data?.total).toBe(2);
    expect(second.data?.total).toBe(2);
    expect(first.data?.items[0].id).not.toBe(second.data?.items[0].id);
    // A cross-facility catalogue record is selectable only once this facility
    // already holds a linked inventory row, matching the existing read policy.
    await pg.query(
      "INSERT INTO inventory(hospital_id,medicine_id,batch_number,quantity) VALUES ($1,$2,'EXISTING',1)",
      [id(1), id(5)],
    );
    const visible = await reads.list('medicines', id(9), {
      ...query,
      limit: 100,
    });
    expect(visible.data?.items.map((row) => row.id)).toContain(id(5));
    await service.create({ ...dto(), medicineId: id(5) }, id(9));
  });
  it('serializes simultaneous manual retries without adding quantity twice', async () => {
    const results = await Promise.allSettled([
      service.create(dto(), id(9)),
      service.create(dto(), id(9)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
      { quantity: 10 },
    ]);
  });
  it('lets authorized staff explicitly review a legacy unit without converting quantity', async () => {
    const created = await service.create(dto(), id(9));
    const batchId = created.data!.id;
    await pg.query('UPDATE inventory SET selling_unit=NULL WHERE id=$1', [
      batchId,
    ]);
    permissions = [];
    await expect(
      service.update(batchId, { unit: 'box' }, id(1), id(9)),
    ).rejects.toMatchObject({ status: 403 });
    permissions = ['inventory.manage'];
    await expect(
      service.update(batchId, { unit: 'box' }, id(2), id(9)),
    ).rejects.toMatchObject({ status: 403 });
    const updated = await service.update(
      batchId,
      { unit: 'box' },
      id(1),
      id(9),
    );
    expect(updated.data).toMatchObject({ unit: 'box', quantity: 10 });
    expect(
      (
        await pg.query(
          'SELECT selling_unit,quantity FROM inventory WHERE id=$1',
          [batchId],
        )
      ).rows,
    ).toEqual([{ selling_unit: 'box', quantity: 10 }]);
    const audits = (
      await pg.query<{ description: string }>(
        'SELECT description FROM audit_logs',
      )
    ).rows;
    expect(JSON.parse(String(audits[1].description))).toMatchObject({
      previousUnit: null,
      unit: 'box',
      quantity: 10,
      actorId: id(9),
    });
    await pg.query('INSERT INTO marketplace_listings VALUES ($1,$2)', [
      id(90),
      batchId,
    ]);
    await expect(
      service.update(batchId, { unit: 'vial' }, id(1), id(9)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('accepts frontend box intake through HTTP validation and returns the unit after refresh', async () => {
    const module = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        InventoryManagementGuard,
        { provide: InventoryService, useValue: service },
        { provide: OperationalReadsService, useValue: reads },
        { provide: StockAccessService, useValue: stockAccess },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = {
            id: id(9),
            facilityId: id(1),
          };
          return true;
        },
      })
      .overrideGuard(OperationalReadGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(DashboardReadGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
    try {
      const added = await request(app.getHttpServer())
        .post('/api/inventory')
        .send(dto())
        .expect(201);
      expect(added.body.data).toMatchObject({ unit: 'box', quantity: 10 });
      const refreshed = await request(app.getHttpServer())
        .get('/api/inventory?page=1&limit=100')
        .expect(200);
      expect(refreshed.body.data.items[0]).toMatchObject({
        unit: 'box',
        qty: 10,
        quantity: 10,
      });
      const invalid = await request(app.getHttpServer())
        .post('/api/inventory')
        .send({ ...dto(), unit: 'tablet' })
        .expect(400);
      expect(invalid.body).toMatchObject({
        success: false,
        message: expect.stringContaining('unit'),
      });
      await pg.query('UPDATE inventory SET selling_unit=NULL WHERE id=$1', [
        added.body.data.id,
      ]);
      await request(app.getHttpServer())
        .patch('/api/inventory/' + added.body.data.id)
        .send({ unit: 'box' })
        .expect(200);
      expect(
        (await request(app.getHttpServer()).get('/api/inventory').expect(200))
          .body.data.items[0],
      ).toMatchObject({ unit: 'box', quantity: 10 });
    } finally {
      await app.close();
    }
  });
  it('validates unit aliases without defaulting or conversion', async () => {
    for (const change of [
      { unit: undefined },
      { unit: 'tablet' },
      { unit: null },
      { unit: 'box', sellingUnit: 'vial' },
    ])
      await expect(
        service.create({ ...dto(), ...change } as any, id(9)),
      ).rejects.toMatchObject({ status: 400 });
    const legacy = await service.create(
      { ...dto(), unit: undefined, sellingUnit: 'pack' },
      id(9),
    );
    expect(legacy.data).toMatchObject({ unit: 'pack', quantity: 10 });
  });
  it('does not guess legacy links and keeps history visible', async () => {
    await pg.query(
      "INSERT INTO inventory(hospital_id,batch_number,quantity) VALUES ($1,'OLD',7)",
      [id(1)],
    );
    const result = await reads.list('inventory', id(9), {
      page: 1,
      limit: 100,
      withinDays: 60,
    });
    expect(result.data?.items[0]).toMatchObject({
      medicine: null,
      drug: null,
      linkageStatus: 'UNLINKED',
      qty: 7,
    });
  });
  it.each([
    { medicineId: undefined },
    { medicineId: 'invalid' },
    { batchNumber: '   ' },
    { expiry: '2027-02-30' },
    { expiry: 'bad' },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: '10' },
    { drug: 'typed name' },
  ])('validates intake DTO %j', async (change) => {
    const errors = await validate(
      plainToInstance(ManualInventoryIntakeDto, { ...dto(), ...change }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
