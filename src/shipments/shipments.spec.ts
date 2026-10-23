/* Supertest exposes untyped JSON bodies; assertions below verify their HTTP shapes. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { ShipmentsService } from './shipments.service';
import {
  AdminShipmentsController,
  ShipmentsController,
} from './shipments.controller';
import {
  PendingShipmentProvider,
  SHIPMENT_TEMPERATURE_PROVIDER,
  ShipmentReading,
} from './shipment-provider';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { NetResponseFilter } from '../helpers/net-response.filter';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';

jest.setTimeout(60000);
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const settings = {
  provider: 'future-supplier',
  deviceId: 'sensor-1',
  minCelsius: 2,
  maxCelsius: 8,
  staleAfterSeconds: 120,
};
describe('shipment temperature monitoring (PostgreSQL and HTTP)', () => {
  let pg: PGlite,
    app: INestApplication,
    jwt: JwtService,
    service: ShipmentsService;
  let configured = false;
  let batch: ShipmentReading[] = [];
  const pull = jest.fn();
  const query = async <T = Record<string, unknown>>(
    sql: string,
    args: unknown[] = [],
  ) => (await pg.query<T>(sql, args)).rows;
  const auth = (n = 14) => `Bearer ${jwt.sign({ id: id(n), mfa: true })}`;
  const get = (path: string, n = 10) =>
    request(app.getHttpServer()).get(path).set('Authorization', auth(n));
  const post = (path: string, body: object, n = 14) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(n))
      .send(body);
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE roles(id int PRIMARY KEY,name text);
     CREATE TABLE hospitals(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
     CREATE TABLE users(id uuid PRIMARY KEY,role_id int,hospital_id uuid,active boolean,verification_status text,account_type text);
     CREATE TABLE role_permissions(role_id int,permission text);
     CREATE TABLE couriers(id uuid PRIMARY KEY,name text,active boolean);
     CREATE TABLE marketplace_orders(id uuid PRIMARY KEY,buyer_id uuid,facility_id uuid,invoice_reference text,order_status text,payment_status text,reservation_state text,fulfillment_state text);
     CREATE TABLE transfer_requests(id uuid PRIMARY KEY,from_hospital uuid,to_hospital uuid,status text);
     CREATE TABLE courier_assignments(id uuid PRIMARY KEY,transfer_id uuid,courier_id uuid,status text);
     CREATE TABLE audit_logs(id uuid,user_id uuid,action text,description text,ip_address text,object_type text,object_id uuid);
     CREATE TABLE notifications(id uuid PRIMARY KEY,user_id uuid,title text,message text);`);
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/shipment-temperature.sql'),
        'utf8',
      ),
    );
    const db = {
      manager: { query },
      query,
      transaction: async (
        levelOrCallback: string | ((m: EntityManager) => Promise<unknown>),
        callback?: (m: EntityManager) => Promise<unknown>,
      ) =>
        pg.transaction(async (tx) =>
          (typeof levelOrCallback === 'function' ? levelOrCallback : callback!)(
            {
              query: async (sql: string, args: unknown[] = []) =>
                (await tx.query(sql, args)).rows,
            } as EntityManager,
          ),
        ),
      getRepository: (entity: unknown) => {
        if (entity === User)
          return {
            findOne: async ({ where }: { where: { id: string } }) => {
              const [a] = await query<{
                id: string;
                role_id: number;
                role_name: string;
                hospital_id: string;
                active: boolean;
                verification_status: string;
                account_type: string;
              }>(
                'SELECT u.*,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1',
                [where.id],
              );
              return a
                ? {
                    ...a,
                    role: { id: a.role_id, name: a.role_name },
                    hospital: {
                      id: a.hospital_id,
                      status: 'ACTIVE',
                      ip_whitelist: [],
                    },
                  }
                : null;
            },
          };
        if (entity === RolePermission)
          return {
            findBy: ({ role_id }: { role_id: number }) =>
              query('SELECT * FROM role_permissions WHERE role_id=$1', [
                role_id,
              ]),
          };
        throw new Error('Unexpected repository');
      },
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'shipment-test-only' })],
      controllers: [ShipmentsController, AdminShipmentsController],
      providers: [
        AuthGuard,
        NetworkAdminGuard,
        ShipmentsService,
        { provide: DataSource, useValue: db },
        {
          provide: SHIPMENT_TEMPERATURE_PROVIDER,
          useValue: { configured: () => configured, readings: pull },
        },
      ],
    }).compile();
    jwt = module.get(JwtService);
    service = module.get(ShipmentsService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(async () => {
    configured = false;
    batch = [];
    pull.mockReset().mockImplementation(() => Promise.resolve(batch));
    await pg.exec(`TRUNCATE shipment_temperature_events,shipment_temperature_readings,shipment_monitors,audit_logs,courier_assignments,transfer_requests,marketplace_orders,couriers,users,role_permissions,roles,hospitals CASCADE;
     INSERT INTO roles VALUES(1,'DOCTOR'),(2,'ADMIN'),(3,'ADMIN'),(4,'FACILITY_ADMIN');
     INSERT INTO role_permissions VALUES(2,'admin.access'),(2,'coldchain.read'),(2,'coldchain.manage'),(3,'admin.access'),(3,'coldchain.read'),(4,'admin.access'),(4,'coldchain.read'),(4,'coldchain.manage');`);
    for (const n of [1, 2, 3])
      await query("INSERT INTO hospitals VALUES($1,'ACTIVE',NULL)", [id(n)]);
    for (const [n, role, facility] of [
      [10, 1, 2],
      [11, 1, 1],
      [12, 1, 3],
      [14, 2, 3],
      [15, 3, 3],
      [16, 4, 3],
    ])
      await query(
        "INSERT INTO users VALUES($1,$2,$3,true,'VERIFIED','DOCTOR')",
        [id(n), role, id(facility)],
      );
    await query("INSERT INTO couriers VALUES($1,'Actual courier',true)", [
      id(20),
    ]);
    await query(
      "INSERT INTO marketplace_orders VALUES($1,$2,$3,'OB-REAL','SHIPPED','PAID','CONSUMED','SHIPPED')",
      [id(30), id(10), id(1)],
    );
    await query("INSERT INTO transfer_requests VALUES($1,$2,$3,'IN_TRANSIT')", [
      id(40),
      id(1),
      id(2),
    ]);
    await query(
      "INSERT INTO courier_assignments VALUES($1,$2,$3,'PICKED_UP')",
      [id(50), id(40), id(20)],
    );
  });
  const create = async (extra: object = {}) =>
    (
      await post('/admin/api/shipments', {
        ...settings,
        orderId: id(30),
        courierId: id(20),
        ...extra,
      }).expect(201)
    ).body.data as { id: string; version: number };
  const enable = async (shipment: string) => {
    configured = true;
    // Use a deterministic earlier monitoring start via the test clock-independent fixture.
    await pg.exec(
      'ALTER TABLE shipment_monitors DISABLE TRIGGER shipment_monitor_history_guard',
    );
    try {
      await query(
        "UPDATE shipment_monitors SET created_at=now()-interval '10 minutes' WHERE id=$1",
        [shipment],
      );
    } finally {
      await pg.exec(
        'ALTER TABLE shipment_monitors ENABLE TRIGGER shipment_monitor_history_guard',
      );
    }
  };
  const reading = (
    eventId = 'event-1',
    celsius = 5,
    ago = 0,
  ): ShipmentReading => ({
    eventId,
    deviceId: 'sensor-1',
    celsius,
    recordedAt: new Date(Date.now() - ago).toISOString(),
  });

  it('persists pending integration with null live data, no fake history, and an explicit sync failure', async () => {
    const s = await create();
    const detail = await get(`/api/shipments/${s.id}/temperature`).expect(200);
    expect(detail.body.data).toMatchObject({
      orderId: id(30),
      courier: { id: id(20), name: 'Actual courier' },
      monitoringStatus: 'PENDING_INTEGRATION',
      temperatureStatus: 'NO_DATA',
      providerConfigured: false,
      latestReading: null,
      excursionCount: 0,
    });
    const history = await get(
      `/api/shipments/${s.id}/temperature/history`,
    ).expect(200);
    expect(history.body.data).toMatchObject({
      monitoringStatus: 'PENDING_INTEGRATION',
      items: [],
      pagination: { total: 0, totalPages: 0 },
    });
    await post(`/admin/api/shipments/${s.id}/temperature/sync`, {}).expect(503);
    await service.poll();
    expect(pull).not.toHaveBeenCalled();
    expect(await query('SELECT * FROM shipment_temperature_readings')).toEqual(
      [],
    );
    expect(new PendingShipmentProvider().configured()).toBe(false);
  });
  it('protects buyer/seller/facility scopes and denies unauthorized configuration', async () => {
    const s = await create();
    await get(`/api/shipments/${s.id}/temperature`, 11).expect(200);
    await get(`/api/shipments/${s.id}/temperature`, 12).expect(404);
    expect(
      (await get('/api/shipments', 12).expect(200)).body.data.pagination.total,
    ).toBe(0);
    expect(
      (await get('/api/shipments', 10).expect(200)).body.data.pagination.total,
    ).toBe(1);
    for (const n of [10, 15, 16])
      await post(
        '/admin/api/shipments',
        { ...settings, orderId: id(30), courierId: id(20) },
        n,
      ).expect(403);
    await request(app.getHttpServer()).get('/api/shipments').expect(401);
    await get('/api/shipments?buyerId=' + id(10)).expect(400);
  });
  it('links transfer monitoring to the actual courier assignment and participating facilities', async () => {
    const response = await post('/admin/api/shipments', {
      ...settings,
      courierAssignmentId: id(50),
    }).expect(201);
    const s = response.body.data;
    expect(s).toMatchObject({
      courierAssignmentId: id(50),
      orderId: null,
      courier: { id: id(20) },
    });
    await get(`/api/shipments/${s.id}/temperature`, 10).expect(200);
    await get(`/api/shipments/${s.id}/temperature`, 11).expect(200);
    await get(`/api/shipments/${s.id}/temperature`, 12).expect(404);
    await query("UPDATE transfer_requests SET status='DELIVERED'");
    expect(
      (await get(`/api/shipments/${s.id}/temperature`).expect(200)).body.data
        .monitoringStatus,
    ).toBe('ENDED');
  });
  it('validates reviewed thresholds and source eligibility, and prevents duplicate shipment/device assignments', async () => {
    await post('/admin/api/shipments', {
      ...settings,
      orderId: id(30),
      courierId: id(20),
      minCelsius: 8,
      maxCelsius: 2,
    }).expect(400);
    await post('/admin/api/shipments', {
      ...settings,
      orderId: id(30),
      courierId: id(20),
      apiKey: 'should-not-be-accepted',
    }).expect(400);
    await post('/admin/api/shipments', {
      ...settings,
      orderId: id(30),
      courierAssignmentId: id(50),
    }).expect(400);
    await query(
      "UPDATE marketplace_orders SET payment_status='AWAITING_PAYMENT'",
    );
    await post('/admin/api/shipments', {
      ...settings,
      orderId: id(30),
      courierId: id(20),
    }).expect(409);
    await query("UPDATE marketplace_orders SET payment_status='PAID'");
    await create();
    await post('/admin/api/shipments', {
      ...settings,
      orderId: id(30),
      courierId: id(20),
    }).expect(409);
    await post('/admin/api/shipments', {
      ...settings,
      courierAssignmentId: id(50),
    }).expect(409);
  });
  it('allows versioned corrections while pending but rejects stale edits and edits after readings', async () => {
    const s = await create();
    const update = (expectedVersion: number) =>
      request(app.getHttpServer())
        .patch(`/admin/api/shipments/${s.id}/monitoring`)
        .set('Authorization', auth())
        .send({ ...settings, expectedVersion });
    expect((await update(1).expect(200)).body.data.version).toBe(2);
    await update(1).expect(409);
    await enable(s.id);
    batch = [reading()];
    await service.sync(id(14), s.id);
    await update(2).expect(409);
  });
  it('deduplicates real adapter readings, records excursions, and preserves the latest timestamp despite delayed data', async () => {
    const s = await create();
    await enable(s.id);
    batch = [reading('old', 9, 60000), reading('new', 5)];
    await service.sync(id(14), s.id);
    await service.sync(id(14), s.id);
    expect(
      await query('SELECT * FROM shipment_temperature_readings'),
    ).toHaveLength(2);
    expect(
      await query('SELECT * FROM shipment_temperature_events'),
    ).toHaveLength(1);
    expect(await query('SELECT * FROM notifications')).toHaveLength(2);
    batch = [reading('delayed', 1, 120000)];
    await service.sync(id(14), s.id);
    const d = (await service.detail(id(10), s.id)).data!;
    expect(d).toMatchObject({
      monitoringStatus: 'RECEIVING',
      temperatureStatus: 'IN_RANGE',
      latestReading: { celsius: 5 },
      excursionCount: 2,
    });
    const h = (
      await get(`/api/shipments/${s.id}/temperature/history?limit=1`).expect(
        200,
      )
    ).body.data;
    expect(h.pagination).toMatchObject({ total: 3, totalPages: 3 });
    expect(h.items[0].celsius).toBe(5);
    expect(await query('SELECT * FROM notifications')).toHaveLength(4);
    const events = (
      await get(`/api/shipments/${s.id}/temperature/events`).expect(200)
    ).body.data;
    expect(events.pagination.total).toBe(2);
    await get(`/api/shipments/${s.id}/temperature/events`, 12).expect(404);
    await expect(
      query('UPDATE shipment_monitors SET min_celsius=1 WHERE id=$1', [s.id]),
    ).rejects.toThrow();
    await expect(
      query('DELETE FROM shipment_temperature_readings'),
    ).rejects.toThrow();
  });
  it('distinguishes stale data from live status and ends monitoring on delivery', async () => {
    const s = await create();
    await enable(s.id);
    batch = [reading('old', 4, 300000)];
    await service.sync(id(14), s.id);
    expect((await service.detail(id(10), s.id)).data!.monitoringStatus).toBe(
      'STALE',
    );
    await query("UPDATE marketplace_orders SET order_status='DELIVERED'");
    expect((await service.detail(id(10), s.id)).data!.monitoringStatus).toBe(
      'ENDED',
    );
    await expect(service.sync(id(14), s.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('rejects invalid batches atomically and rejects provider event identity conflicts', async () => {
    const s = await create();
    await enable(s.id);
    batch = [reading('ok'), { ...reading('wrong'), deviceId: 'other-device' }];
    await expect(service.sync(id(14), s.id)).rejects.toMatchObject({
      status: 503,
    });
    expect(await query('SELECT * FROM shipment_temperature_readings')).toEqual(
      [],
    );
    expect(await query('SELECT * FROM notifications')).toEqual([]);
    batch = [reading('same')];
    await service.sync(id(14), s.id);
    batch = [reading('new'), { ...batch[0], celsius: 6 }];
    await expect(service.sync(id(14), s.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await query('SELECT * FROM shipment_temperature_readings'),
    ).toHaveLength(1);
    pull.mockRejectedValueOnce(new Error('private-provider-secret'));
    const error = await post(
      `/admin/api/shipments/${s.id}/temperature/sync`,
      {},
    ).expect(503);
    expect(JSON.stringify(error.body)).not.toContain('private-provider-secret');
  });
});
