import { PGlite } from '@electric-sql/pglite';
import { DataSource, EntitySchema } from 'typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pgliteDataSource } from '../../test/pglite-data-source';
import { TransferRequestsService } from './transfer_requests.service';
import { TransferRequest } from './entities/transfer_request.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { InventoryAccessGrant } from '../guards/entities/inventory-access-grant.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { transferAvailableQuantity } from './transfer-availability';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import requestHttp from 'supertest';
import { TransferRequestsController } from './transfer_requests.controller';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { Server } from 'node:http';
import { Notification } from '../notification/entities/notification.entity';
import { NetResponseFilter } from '../helpers/net-response.filter';

jest.setTimeout(60000);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = { type: 'uuid' as const, primary: true };
const relation = (
  target: () =>
    | typeof Hospital
    | typeof Medicine
    | typeof Inventory
    | typeof User
    | typeof Role,
  name: string,
) => ({ type: 'many-to-one' as const, target, joinColumn: { name } });
const entities = [
  new EntitySchema<Hospital>({
    name: 'Hospital',
    target: Hospital,
    tableName: 'hospitals',
    columns: {
      id: uuid,
      name: { type: 'text' },
      city: { type: 'text' },
      status: { type: 'text' },
      latitude: { type: 'numeric', nullable: true },
      longitude: { type: 'numeric', nullable: true },
      deleted_at: { type: 'timestamptz', nullable: true },
    },
  }),
  new EntitySchema<Medicine>({
    name: 'Medicine',
    target: Medicine,
    tableName: 'medicines',
    columns: {
      id: uuid,
      generic_name: { type: 'text' },
      deleted_at: { type: 'timestamptz', nullable: true, deleteDate: true },
    },
  }),
  new EntitySchema<Inventory>({
    name: 'Inventory',
    target: Inventory,
    tableName: 'inventory',
    columns: {
      id: uuid,
      quantity: { type: 'int' },
      status: { type: 'text' },
      selling_unit: { type: 'text', nullable: true },
      batch_number: { type: 'text' },
      serial_number: { type: 'text', nullable: true },
      storage_unit_id: { type: 'uuid', nullable: true },
      expiry_date: { type: 'date' },
    },
    relations: {
      hospital: relation(() => Hospital, 'hospital_id'),
      medicine: relation(() => Medicine, 'medicine_id'),
    },
  }),
  new EntitySchema<Role>({
    name: 'Role',
    target: Role,
    tableName: 'roles',
    columns: { id: { type: 'int', primary: true }, name: { type: 'text' } },
  }),
  new EntitySchema<User>({
    name: 'User',
    target: User,
    tableName: 'users',
    columns: {
      id: uuid,
      active: { type: 'boolean' },
      verification_status: { type: 'text' },
    },
    relations: {
      hospital: relation(() => Hospital, 'hospital_id'),
      role: relation(() => Role, 'role_id'),
    },
  }),
  new EntitySchema<RolePermission>({
    name: 'RolePermission',
    target: RolePermission,
    tableName: 'role_permissions',
    columns: {
      id: uuid,
      role_id: { type: 'int' },
      permission: { type: 'text' },
    },
  }),
  new EntitySchema<InventoryAccessGrant>({
    name: 'InventoryAccessGrant',
    target: InventoryAccessGrant,
    tableName: 'inventory_access_grants',
    columns: {
      id: uuid,
      user_id: { type: 'uuid' },
      facility_id: { type: 'uuid' },
    },
  }),
  new EntitySchema<VerificationApplication>({
    name: 'VerificationApplication',
    target: VerificationApplication,
    tableName: 'verification_applications',
    columns: {
      id: uuid,
      user_id: { type: 'uuid' },
      status: { type: 'text' },
      submitted_at: { type: 'timestamptz' },
    },
  }),
  new EntitySchema<TransferRequest>({
    name: 'TransferRequest',
    target: TransferRequest,
    tableName: 'transfer_requests',
    columns: {
      id: { ...uuid, generated: 'uuid' },
      quantity: { type: 'int' },
      selling_unit: { type: 'text', nullable: true },
      batch_number: { type: 'text', nullable: true },
      expiry_date: { type: 'date', nullable: true },
      dispatched_at: { type: 'timestamptz', nullable: true },
      delivered_at: { type: 'timestamptz', nullable: true },
      dispatched_by: { type: 'uuid', nullable: true },
      delivered_by: { type: 'uuid', nullable: true },
      recipient_inventory_id: { type: 'uuid', nullable: true },
      status: { type: 'text' },
      approved_at: { type: 'timestamptz', nullable: true },
      created_at: { type: 'timestamptz', createDate: true },
    },
    relations: {
      fromHospital: relation(() => Hospital, 'from_hospital'),
      toHospital: relation(() => Hospital, 'to_hospital'),
      medicine: relation(() => Medicine, 'medicine_id'),
      inventory: relation(() => Inventory, 'inventory_id'),
      approvedBy: relation(() => User, 'approved_by'),
    },
  }),
  new EntitySchema<Notification>({
    name: 'Notification',
    target: Notification,
    tableName: 'notifications',
    columns: {
      id: { ...uuid, generated: 'uuid' },
      title: { type: 'text' },
      message: { type: 'text' },
      read: { type: 'boolean', default: false },
    },
    relations: { user: relation(() => User, 'user_id') },
  }),
];

describe('redistribution admission using real repositories and PostgreSQL storage', () => {
  let pg: PGlite,
    db: DataSource,
    service: TransferRequestsService,
    app: INestApplication<Server>,
    jwt: JwtService;
  const request = (quantity = 3) => ({
    inventoryItemId: id(20),
    recipientFacilityId: id(2),
    quantity,
  });
  const count = async () =>
    (
      await pg.query<{ count: number }>(
        'SELECT count(*)::int count FROM transfer_requests',
      )
    ).rows[0].count;
  const available = async () =>
    (
      await pg.query<{ available: number }>(
        `SELECT ${transferAvailableQuantity()} available FROM inventory i WHERE id=$1`,
        [id(20)],
      )
    ).rows[0].available;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,status text,latitude numeric,longitude numeric,deleted_at timestamptz);
      CREATE TABLE medicines(id uuid PRIMARY KEY,generic_name text,deleted_at timestamptz);
      CREATE TABLE roles(id int PRIMARY KEY,name text);
      CREATE TABLE users(id uuid PRIMARY KEY,hospital_id uuid,role_id int,active boolean,verification_status text);
      CREATE TABLE role_permissions(id uuid DEFAULT gen_random_uuid(),role_id int,permission text);
      CREATE TABLE inventory_access_grants(id uuid DEFAULT gen_random_uuid(),user_id uuid,facility_id uuid);
      CREATE TABLE verification_applications(id uuid PRIMARY KEY,user_id uuid,status text,submitted_at timestamptz DEFAULT now());
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,quantity int,status text,selling_unit text,batch_number text,expiry_date date);
      CREATE TABLE transfer_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),from_hospital uuid,to_hospital uuid,medicine_id uuid,inventory_id uuid,quantity int,status text,approved_by uuid,approved_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE marketplace_orders(id uuid DEFAULT gen_random_uuid(),inventory_item_id uuid,quantity int,reservation_state text,expires_at timestamptz);
    `);
    const migration = readFileSync(
      resolve(__dirname, '../../database/redistribution-selection.sql'),
      'utf8',
    );
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.exec(
      readFileSync(
        resolve(__dirname, '../../database/frontend-contract.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      readFileSync(
        resolve(__dirname, '../../database/frontend-contract.sql'),
        'utf8',
      ),
    );
    await pg.exec(`ALTER TABLE inventory ADD COLUMN serial_number text, ADD COLUMN storage_unit_id uuid;
      CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,read boolean DEFAULT false);
      CREATE TABLE audit_logs(user_id uuid,action text,description text,ip_address text,object_type text,object_id uuid,before_status text,after_status text);`);
    db = await pgliteDataSource(pg, entities);
    service = new TransferRequestsService(
      db.getRepository(TransferRequest),
      db.getRepository(Inventory),
      db.getRepository(Hospital),
      new StockAccessService(db),
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'redistribution-test-secret' })],
      controllers: [TransferRequestsController],
      providers: [
        AuthGuard,
        { provide: DataSource, useValue: db },
        { provide: TransferRequestsService, useValue: service },
        { provide: OperationalReadsService, useValue: {} },
      ],
    })
      .overrideGuard(OperationalReadGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new NetResponseFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    await pg.close();
  });
  beforeEach(async () => {
    await pg.exec(
      'TRUNCATE hospitals,medicines,roles,users,role_permissions,inventory_access_grants,verification_applications,inventory,transfer_requests,marketplace_orders,notifications,audit_logs CASCADE',
    );
    await pg.query(
      `INSERT INTO hospitals VALUES ($1,'Donor','Lagos','ACTIVE',6.5,3.3,NULL),($2,'Nearby','Ikeja','ACTIVE',6.6,3.35,NULL),($3,'Far away','Abuja','ACTIVE',9.0,7.4,NULL),($4,'Suspended','Lagos','SUSPENDED',6.51,3.31,NULL),($5,'Deleted','Lagos','ACTIVE',6.52,3.32,now()),($6,'Unlocated','Lagos','ACTIVE',NULL,NULL,NULL)`,
      [id(1), id(2), id(3), id(4), id(5), id(6)],
    );
    await pg.exec(
      "INSERT INTO roles VALUES (1,'PHARMACIST'),(2,'ONCOLOGIST'); INSERT INTO role_permissions(role_id,permission) VALUES (1,'inventory.manage')",
    );
    await pg.query(
      "INSERT INTO users VALUES ($1,$2,1,true,'VERIFIED'),($3,$4,1,true,'VERIFIED'),($5,$2,2,true,'VERIFIED')",
      [id(10), id(1), id(11), id(2), id(12)],
    );
    await pg.query("INSERT INTO medicines VALUES ($1,'Named medicine',NULL)", [
      id(30),
    ]);
    await pg.query(
      "INSERT INTO inventory(id,hospital_id,medicine_id,quantity,status,selling_unit,batch_number,expiry_date) VALUES ($1,$2,$3,10,'AVAILABLE','box','LOT-2026',CURRENT_DATE+30)",
      [id(20), id(1), id(30)],
    );
  });

  it('returns named, eligible recipients only and supports an empty result', async () => {
    const result = await service.suggest(id(20), id(10));
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      id: id(2),
      facilityId: id(2),
      name: 'Nearby',
      city: 'Ikeja',
    });
    await pg.query('UPDATE hospitals SET latitude=NULL WHERE id=$1', [id(2)]);
    expect((await service.suggest(id(20), id(10))).data).toEqual([]);
  });

  it('checks current grants and ownership for suggestions and creation', async () => {
    await expect(service.suggest(id(20), id(11))).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.create(request(), id(11))).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.suggest(id(20), id(12))).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.create(request(), id(12))).rejects.toMatchObject({
      status: 403,
    });
    await pg.exec('DELETE FROM role_permissions');
    await expect(service.create(request(), id(10))).rejects.toMatchObject({
      status: 403,
    });
    expect(await count()).toBe(0);
  });

  it.each([1, 3, 4, 5, 6, 99])(
    'rejects an ineligible recipient %s even if supplied directly',
    async (recipient) => {
      await expect(
        service.create(
          { ...request(), recipientFacilityId: id(recipient) },
          id(10),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(await count()).toBe(0);
    },
  );

  it.each(['QUARANTINED', 'DISPOSED', 'RECALLED', 'REDISTRIBUTED'])(
    'rejects %s stock in suggestion and admission',
    async (status) => {
      await pg.query('UPDATE inventory SET status=$1', [status]);
      await expect(service.suggest(id(20), id(10))).rejects.toMatchObject({
        status: 400,
      });
      await expect(service.create(request(), id(10))).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each([0, -1, 1.5, 11, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid or excessive quantity %s',
    async (quantity) => {
      await expect(
        service.create(request(quantity), id(10)),
      ).rejects.toMatchObject({ status: 400 });
      expect(await count()).toBe(0);
    },
  );

  it.each([
    'expiry_date=CURRENT_DATE-1',
    'expiry_date=CURRENT_DATE',
    'quantity=0',
    'selling_unit=NULL',
    "selling_unit='tablet'",
  ])('rejects unavailable batch state %s', async (state) => {
    await pg.exec(`UPDATE inventory SET ${state}`);
    await expect(service.create(request(), id(10))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects deleted and unlinked medicines', async () => {
    await pg.exec('UPDATE medicines SET deleted_at=now()');
    await expect(service.create(request(), id(10))).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.suggest(id(20), id(10))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('admits concurrent submissions only within live available stock and preserves unit snapshots', async () => {
    const results = await Promise.allSettled([
      service.create(request(7), id(10)),
      service.create(request(7), id(10)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await count()).toBe(1);
    expect(await available()).toBe(3);
    expect(
      (
        await pg.query(
          'SELECT quantity,selling_unit,status FROM transfer_requests',
        )
      ).rows,
    ).toEqual([
      { quantity: 7, selling_unit: 'box', status: 'PENDING_APPROVAL' },
    ]);
    expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
      { quantity: 10 },
    ]);
  });

  it('subtracts active marketplace holds and both pending transfer statuses', async () => {
    await pg.query(
      "INSERT INTO marketplace_orders(inventory_item_id,quantity,reservation_state,expires_at) VALUES ($1,4,'RESERVED',now()+interval '15 minutes'),($1,99,'RESERVED',now()-interval '1 minute'),($1,99,'RELEASED',now()+interval '15 minutes')",
      [id(20)],
    );
    await service.create(request(3), id(10));
    await pg.exec("UPDATE transfer_requests SET status='PENDING'");
    expect(await available()).toBe(3);
    await expect(service.create(request(4), id(10))).rejects.toMatchObject({
      status: 400,
    });
    await service.create(request(3), id(10));
    await expect(service.suggest(id(20), id(10))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('approves once as the recipient, consumes the snapshotted unit, and does not mark delivery', async () => {
    const created = await service.create(request(3), id(10));
    await expect(
      service.decide(created.data!.id, true, id(10)),
    ).rejects.toMatchObject({ status: 404 });
    const approved = await service.decide(created.data!.id, true, id(11));
    expect(approved.data?.status).toBe('APPROVED');
    expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
      { quantity: 7 },
    ]);
    await expect(
      service.decide(created.data!.id, true, id(11)),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await pg.query('SELECT approved_by FROM transfer_requests')).rows,
    ).toEqual([{ approved_by: id(11) }]);
  });

  it.each([
    "selling_unit='vial'",
    'expiry_date=CURRENT_DATE-1',
    "status='QUARANTINED'",
    'quantity=1',
  ])('rechecks changed stock on approval: %s', async (state) => {
    const created = await service.create(request(3), id(10));
    await pg.exec(`UPDATE inventory SET ${state}`);
    await expect(
      service.decide(created.data!.id, true, id(11)),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await pg.query<{ status: string }>(
          'SELECT status FROM transfer_requests',
        )
      ).rows,
    ).toEqual([{ status: 'PENDING_APPROVAL' }]);
    await service.decide(created.data!.id, false, id(11));
    expect(
      (
        await pg.query<{ status: string }>(
          'SELECT status FROM transfer_requests',
        )
      ).rows,
    ).toEqual([{ status: 'REJECTED' }]);
  });

  it('does not bypass reservations via request edits and releases an allocation on donor deletion', async () => {
    const first = await service.create(request(6), id(10));
    await expect(
      service.update(first.data!.id, { quantity: 11 }, id(10)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(first.data!.id, { recipientFacilityId: id(3) }, id(10)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(first.data!.id, { quantity: 1 }, id(11)),
    ).rejects.toMatchObject({ status: 404 });
    await service.update(first.data!.id, { quantity: 4 }, id(10));
    expect(await available()).toBe(6);
    await service.remove(first.data!.id, id(10));
    expect(await available()).toBe(10);
  });

  it('serves the dialog and approval routes with signed facility credentials and unchanged payloads', async () => {
    const token = jwt.sign({ id: id(10) });
    const recipient = jwt.sign({ id: id(11) });
    const denied = jwt.sign({ id: id(12) });
    const server = app.getHttpServer();
    await requestHttp(server).get('/api/transfers/suggest').expect(401);
    await requestHttp(server)
      .get('/api/transfers/suggest')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await requestHttp(server)
      .get('/api/transfers/suggest?inventoryItemId=invalid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const suggestions = await requestHttp(server)
      .get(`/api/transfers/suggest?inventoryItemId=${id(20)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((suggestions.body as { data: unknown }).data).toMatchObject([
      { id: id(2), name: 'Nearby' },
    ]);
    await requestHttp(server)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${denied}`)
      .send(request())
      .expect(403);
    await requestHttp(server)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...request(), quantity: 1.5 })
      .expect(400);
    await requestHttp(server)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...request(), unit: 'vial' })
      .expect(400);
    const created = await requestHttp(server)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send(request())
      .expect(201);
    const transferId = (created.body as { data: { id: string } }).data.id;
    const approved = await requestHttp(server)
      .post(`/api/transfers/${transferId}/approve`)
      .set('Authorization', `Bearer ${recipient}`)
      .expect(201);
    expect((approved.body as { data: { status: string } }).data.status).toBe(
      'APPROVED',
    );
    expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
      { quantity: 7 },
    ]);
  });

  it('rolls back stock consumption if recording approval fails', async () => {
    const created = await service.create(request(), id(10));
    await pg.exec(`CREATE FUNCTION reject_approval_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='APPROVED' THEN RAISE EXCEPTION 'approval persistence failed'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER approval_failure BEFORE UPDATE ON transfer_requests FOR EACH ROW EXECUTE FUNCTION reject_approval_test();`);
    try {
      await expect(
        service.decide(created.data!.id, true, id(11)),
      ).rejects.toThrow('approval persistence failed');
      expect((await pg.query('SELECT quantity FROM inventory')).rows).toEqual([
        { quantity: 10 },
      ]);
      expect(
        (
          await pg.query<{ status: string }>(
            'SELECT status FROM transfer_requests',
          )
        ).rows,
      ).toEqual([{ status: 'PENDING_APPROVAL' }]);
    } finally {
      await pg.exec(
        'DROP TRIGGER approval_failure ON transfer_requests; DROP FUNCTION reject_approval_test()',
      );
    }
  });
  it('moves approved stock once, enforces custody, and exposes persisted actions in the full list', async () => {
    const created = await service.create(request(10), id(10));
    const transferId = created.data!.id;
    await expect(
      service.move(transferId, 'deliver', id(11)),
    ).rejects.toMatchObject({ status: 409 });
    const pending = await service.listForActor(id(11), {
      page: 1,
      limit: 1,
    } as never);
    expect(pending.data!.items[0]).toMatchObject({
      status: 'PENDING_APPROVAL',
      allowedActions: ['approve', 'reject'],
      drug: 'Named medicine',
      lot: 'LOT-2026',
      unit: 'box',
    });
    await service.decide(transferId, true, id(11));
    await expect(
      service.move(transferId, 'dispatch', id(11)),
    ).rejects.toMatchObject({ status: 403 });
    const dispatched = await service.move(transferId, 'dispatch', id(10));
    expect(dispatched.data!.transfer).toMatchObject({
      status: 'IN_TRANSIT',
      allowedActions: [],
    });
    await service.move(transferId, 'dispatch', id(10));
    expect(
      (await pg.query('SELECT quantity FROM inventory WHERE id=$1', [id(20)]))
        .rows,
    ).toEqual([{ quantity: 0 }]);
    const delivered = await service.move(transferId, 'deliver', id(11));
    expect(delivered.data!.transfer).toMatchObject({
      status: 'DELIVERED',
      allowedActions: [],
    });
    expect(delivered.data!.transfer.deliveredAt).toBeTruthy();
    await service.move(transferId, 'deliver', id(11));
    expect(
      (
        await pg.query(
          'SELECT quantity,selling_unit,batch_number FROM inventory WHERE hospital_id=$1',
          [id(2)],
        )
      ).rows,
    ).toEqual([
      { quantity: 10, selling_unit: 'box', batch_number: 'LOT-2026' },
    ]);
    expect(
      (
        await pg.query<{ count: number }>(
          'SELECT count(*)::int count FROM audit_logs',
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await pg.query<{ count: number }>(
          'SELECT count(*)::int count FROM notifications',
        )
      ).rows[0].count,
    ).toBe(3);
  });
  it('rolls back receipt and audit when notification persistence fails', async () => {
    const created = await service.create(request(), id(10));
    await service.decide(created.data!.id, true, id(11));
    await service.move(created.data!.id, 'dispatch', id(10));
    await pg.exec(`CREATE FUNCTION fail_transfer_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notice failure'; END $$;
      CREATE TRIGGER notice_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_transfer_notice();`);
    try {
      await expect(
        service.move(created.data!.id, 'deliver', id(11)),
      ).rejects.toThrow('notice failure');
      expect(
        (
          await pg.query<{ status: string }>(
            'SELECT status FROM transfer_requests',
          )
        ).rows[0].status,
      ).toBe('IN_TRANSIT');
      expect(
        (
          await pg.query<{ count: number }>(
            'SELECT count(*)::int count FROM inventory WHERE hospital_id=$1',
            [id(2)],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await pg.query<{ count: number }>(
            'SELECT count(*)::int count FROM audit_logs',
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await pg.exec(
        'DROP TRIGGER notice_failure ON notifications; DROP FUNCTION fail_transfer_notice()',
      );
    }
  });
  it('returns all matching transfers over HTTP, scopes facilities, and requires current admin grants', async () => {
    await service.create(request(2), id(10));
    await service.create(request(2), id(10));
    await pg.exec(
      "INSERT INTO roles VALUES (3,'ADMIN'); INSERT INTO role_permissions(role_id,permission) VALUES (3,'admin.access'),(3,'transfer.read')",
    );
    await pg.query("INSERT INTO users VALUES ($1,$2,3,true,'VERIFIED')", [
      id(13),
      id(1),
    ]);
    await pg.query(
      "INSERT INTO transfer_requests(id,from_hospital,to_hospital,medicine_id,inventory_id,quantity,status) VALUES ($1,$2,$3,$4,$5,1,'PENDING_APPROVAL')",
      [id(60), id(3), id(6), id(30), id(20)],
    );
    const get = (actor: number, query = '') =>
      requestHttp(app.getHttpServer())
        .get(`/api/transfers${query}`)
        .set('Authorization', `Bearer ${jwt.sign({ id: id(actor) })}`);
    const facility = await get(10, '?page=99&limit=1').expect(200);
    expect(
      (facility.body as { data: { items: unknown[]; total: number } }).data,
    ).toMatchObject({
      total: 2,
      items: [expect.anything(), expect.anything()],
    });
    const network = await get(13).expect(200);
    expect((network.body as { data: { total: number } }).data.total).toBe(3);
    await get(10, `?facilityId=${id(3)}`).expect(403);
    expect(
      (
        (await get(10, '?q=does-not-exist')).body as {
          data: { items: unknown[] };
        }
      ).data.items,
    ).toEqual([]);
    await get(10, '?status=COMPLETED').expect(422);
    await pg.exec(
      "DELETE FROM role_permissions WHERE permission='transfer.read'",
    );
    await get(13).expect(403);
    await requestHttp(app.getHttpServer()).get('/api/transfers').expect(401);
  });
  it('requires consistent recipient stock units and merges one receipt exactly once', async () => {
    const created = await service.create(request(3), id(10));
    await service.decide(created.data!.id, true, id(11));
    await service.move(created.data!.id, 'dispatch', id(10));
    await pg.query(
      "INSERT INTO inventory(id,hospital_id,medicine_id,quantity,status,selling_unit,batch_number,expiry_date) VALUES ($1,$2,$3,2,'AVAILABLE','vial','LOT-2026',CURRENT_DATE+30)",
      [id(21), id(2), id(30)],
    );
    await expect(
      service.move(created.data!.id, 'deliver', id(11)),
    ).rejects.toMatchObject({ status: 409 });
    await pg.query("UPDATE inventory SET selling_unit='box' WHERE id=$1", [
      id(21),
    ]);
    await service.move(created.data!.id, 'deliver', id(11));
    await service.move(created.data!.id, 'deliver', id(11));
    expect(
      (await pg.query('SELECT quantity FROM inventory WHERE id=$1', [id(21)]))
        .rows,
    ).toEqual([{ quantity: 5 }]);
    expect(
      (await pg.query('SELECT recipient_inventory_id FROM transfer_requests'))
        .rows,
    ).toEqual([{ recipient_inventory_id: id(21) }]);
  });
});
