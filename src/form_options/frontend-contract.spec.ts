/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Supertest JSON response bodies are inspected by assertions. */
import { PGlite } from '@electric-sql/pglite';
import { DataSource, EntitySchema } from 'typeorm';
import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Workbook } from 'exceljs';
import { pgliteDataSource } from '../../test/pglite-data-source';
import { FormOptionsService } from './form-options.service';
import { FormOptionsController } from './form-options.module';
import { StockAccessService } from '../guards/stock-access.service';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadGuard } from '../guards/operational-read.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { PrescriptionsController } from '../prescriptions/prescriptions.controller';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { Prescription } from '../prescriptions/entities/prescription.entity';
import { PrescriptionReviewController } from '../prescriptions/prescription-review.controller';
import { PrescriptionReviewService } from '../prescriptions/prescription-review.service';
import { OrderEvent } from '../prescriptions/entities/order-event.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { InventoryAccessGrant } from '../guards/entities/inventory-access-grant.entity';
import { ReportsService, reportCsv } from '../dashboard/reports.service';
import { ReportsController } from '../dashboard/dashboard.controller';
import { NetResponseFilter } from '../helpers/net-response.filter';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { SettingsController } from '../settings/settings.controller';

jest.setTimeout(60000);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = { type: 'uuid' as const, primary: true };
const text = { type: 'text' as const, nullable: true };
const date = { type: 'timestamptz' as const, nullable: true };
const schemas = [
  new EntitySchema<Setting>({
    name: 'Setting',
    target: Setting,
    tableName: 'settings',
    columns: {
      key: { type: 'text', primary: true },
      value: { type: 'jsonb', nullable: true },
      updated_at: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema<Hospital>({
    name: 'Hospital',
    target: Hospital,
    tableName: 'hospitals',
    columns: {
      id: uuid,
      name: text,
      city: text,
      status: text,
      facility_type: text,
      deleted_at: date,
    },
  }),
  new EntitySchema<Role>({
    name: 'Role',
    target: Role,
    tableName: 'roles',
    columns: { id: { type: 'int', primary: true }, name: text },
  }),
  new EntitySchema<User>({
    name: 'User',
    target: User,
    tableName: 'users',
    columns: {
      id: uuid,
      active: { type: 'boolean' },
      account_type: text,
      verification_status: text,
      first_name: text,
      last_name: text,
    },
    relations: {
      hospital: {
        type: 'many-to-one',
        target: () => Hospital,
        joinColumn: { name: 'hospital_id' },
      },
      role: {
        type: 'many-to-one',
        target: () => Role,
        joinColumn: { name: 'role_id' },
      },
    },
  }),
  new EntitySchema<RolePermission>({
    name: 'RolePermission',
    target: RolePermission,
    tableName: 'role_permissions',
    columns: { id: uuid, role_id: { type: 'int' }, permission: text },
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
      status: text,
      submitted_at: date,
    },
  }),
  new EntitySchema<Prescription>({
    name: 'Prescription',
    target: Prescription,
    tableName: 'prescriptions',
    columns: {
      id: { ...uuid, generated: 'uuid' },
      display_id: text,
      patient_ref: text,
      icd10: text,
      description: { ...text, nullable: true },
      tnm_stage: text,
      drug_id: { type: 'uuid' },
      qty: { type: 'int' },
      insurer: text,
      pharmacy_facility_id: { type: 'uuid' },
      auth_status: text,
      order_stage: text,
      version: { type: 'int', default: 1 },
      prescriber_id: { type: 'uuid' },
      created_at: { type: 'timestamptz', createDate: true },
      updated_at: { type: 'timestamptz', updateDate: true },
    },
  }),
  new EntitySchema<OrderEvent>({
    name: 'OrderEvent',
    target: OrderEvent,
    tableName: 'order_events',
    columns: {
      id: { ...uuid, generated: 'uuid' },
      order_id: { type: 'uuid' },
      step: text,
      state: text,
      actor_id: { type: 'uuid', nullable: true },
      event_type: { ...text, nullable: true },
      message: { ...text, nullable: true },
      review_version: { type: 'int', nullable: true },
      at: { type: 'timestamptz', createDate: true },
    },
  }),
];

describe('frontend contract with JWT sessions and PostgreSQL records', () => {
  let pg: PGlite,
    db: DataSource,
    app: INestApplication<Server>,
    jwt: JwtService;
  let forms: FormOptionsService, reports: ReportsService;
  const sql = async (query: string, args: unknown[] = []) =>
    (await pg.query(query, args)).rows as Record<string, unknown>[];
  const token = (n = 10) => `Bearer ${jwt.sign({ id: id(n) })}`;
  const get = (url: string, n = 10) =>
    request(app.getHttpServer()).get(url).set('Authorization', token(n));
  const prescription = () => ({
    patient_ref: 'patient-pseudonym',
    icd10: 'C50.9',
    tnm_stage: 'T2 N0 M0',
    insurer: 'reviewed-plan',
    drug_id: id(30),
    qty: 2,
    pharmacy_facility_id: id(2),
  });
  const post = (url: string, body: object, n = 10) =>
    request(app.getHttpServer())
      .post(url)
      .set('Authorization', token(n))
      .send(body);
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,status text,facility_type text,deleted_at timestamptz,state text);
      CREATE TABLE roles(id int PRIMARY KEY,name text);
      CREATE TABLE users(id uuid PRIMARY KEY,hospital_id uuid,role_id int,active boolean,account_type text,verification_status text,first_name text DEFAULT 'Recorded',last_name text DEFAULT 'Clinician');
      CREATE TABLE role_permissions(id uuid DEFAULT gen_random_uuid(),role_id int,permission text);
      CREATE TABLE inventory_access_grants(id uuid,user_id uuid,facility_id uuid);
      CREATE TABLE verification_applications(id uuid,user_id uuid,status text,submitted_at timestamptz DEFAULT now());
      CREATE TABLE medicines(id uuid PRIMARY KEY,generic_name text,gtin text,deleted_at timestamptz,catalog_facility_id uuid,brand_name text,strength text,storage_temperature text);
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,batch_number text,expiry_date date,quantity int,selling_unit text,status text,created_at timestamptz DEFAULT now());
      CREATE TABLE transfer_requests(id uuid PRIMARY KEY,inventory_id uuid,status text);
      CREATE TABLE prescriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),display_id text UNIQUE,patient_ref text,icd10 text,tnm_stage text,drug_id uuid,qty int,insurer text,pharmacy_facility_id uuid,auth_status text,order_stage text,prescriber_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE order_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,step text,state text,at timestamptz DEFAULT now());
      CREATE TABLE audit_logs(id uuid,user_id uuid,action text,description text,ip_address text,object_type text,event_key uuid,object_id uuid,before_status text,after_status text,created_at timestamptz DEFAULT now());`);
    await pg.exec(
      'CREATE TABLE settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now())',
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/frontend-contract.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/prescription-review.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/prescription-description.sql'),
        'utf8',
      ),
    );
    db = await pgliteDataSource(pg, schemas);
    forms = new FormOptionsService(db, new StockAccessService(db));
    reports = new ReportsService(db, forms);
    const prescriptions = new PrescriptionsService(
      db.getRepository(Prescription),
      db.getRepository(OrderEvent),
      db.getRepository(User),
      forms,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'frontend-contract-test' })],
      controllers: [
        FormOptionsController,
        PrescriptionsController,
        PrescriptionReviewController,
        ReportsController,
        SettingsController,
      ],
      providers: [
        AuthGuard,
        NetworkAdminGuard,
        {
          provide: PrescriptionReviewService,
          useValue: new PrescriptionReviewService(db),
        },
        { provide: DataSource, useValue: db },
        { provide: FormOptionsService, useValue: forms },
        { provide: PrescriptionsService, useValue: prescriptions },
        { provide: ReportsService, useValue: reports },
        {
          provide: SettingsService,
          useValue: new SettingsService(db.getRepository(Setting)),
        },
        {
          provide: OperationalReadsService,
          useValue: new OperationalReadsService(db),
        },
      ],
    })
      .overrideGuard(OperationalReadGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(async () => {
    await pg.exec(
      'TRUNCATE hospitals,users,roles,role_permissions,inventory_access_grants,verification_applications,medicines,inventory,transfer_requests,prescriptions,order_events,audit_logs,form_options,settings CASCADE',
    );
    await sql(
      `INSERT INTO hospitals(id,name,city,status,facility_type,deleted_at) VALUES ($1,'Clinic','Lagos','ACTIVE','CLINIC',NULL),($2,'Named pharmacy','Ikeja','ACTIVE','PHARMACY',NULL),($3,'Second pharmacy','Lagos','ACTIVE','PHARMACY',NULL),($4,'Unknown pharmacy','Lagos',NULL,'PHARMACY',NULL)`,
      [id(1), id(2), id(3), id(4)],
    );
    await pg.exec(
      "INSERT INTO roles VALUES (1,'DOCTOR'),(2,'PHARMACIST'),(3,'ADMIN'); INSERT INTO role_permissions(role_id,permission) VALUES (1,'report.export'),(3,'report.export'),(3,'admin.access')",
    );
    await sql(
      "INSERT INTO users(id,hospital_id,role_id,active,account_type,verification_status) VALUES ($1,$2,1,true,'DOCTOR','VERIFIED'),($3,$4,2,true,'PHARMACIST','VERIFIED'),($5,$6,2,true,'PHARMACY_STORE','VERIFIED'),($7,$2,3,true,NULL,'VERIFIED'),($8,$9,2,true,'PHARMACIST','VERIFIED')",
      [id(10), id(1), id(11), id(2), id(12), id(3), id(13), id(14), id(4)],
    );
    await pg.exec(
      "INSERT INTO form_options(context,value,label) VALUES ('prescription','reviewed-plan','Reviewed payment plan'),('marketplace','Radiopharmaceuticals','Radiopharmaceuticals'),('settings','ZAR','South African rand')",
    );
    await sql(
      "INSERT INTO medicines(id,generic_name,gtin,deleted_at) VALUES ($1,'Named medicine','recorded-gtin',NULL)",
      [id(30)],
    );
    await sql(
      "INSERT INTO inventory VALUES ($1,$2,$3,'OWN-LOT',CURRENT_DATE+30,0,'box','AVAILABLE',now()),($4,$5,$3,'OTHER-LOT',CURRENT_DATE+30,4,'box','AVAILABLE',now())",
      [id(20), id(1), id(30), id(21), id(2)],
    );
  });
  it('requires authentication and rejects missing and unknown contexts', async () => {
    await request(app.getHttpServer())
      .get('/api/form-options?context=settings')
      .expect(401);
    const response = await get('/api/form-options?context=bogus').expect(422);
    expect(response.body).toMatchObject({
      success: false,
      data: null,
      code: 'INVALID_CONTEXT',
    });
    await get('/api/form-options').expect(422);
  });
  it.each([
    ['prescription', 'insurers', 'reviewed-plan'],
    ['marketplace', 'categories', 'Radiopharmaceuticals'],
    ['settings', 'currencies', 'ZAR'],
    ['reports', 'reportFormats', 'CSV'],
  ])(
    'returns authorized %s choices and no fabricated fallbacks',
    async (context, group, value) => {
      const response = await get(`/api/form-options?context=${context}`).expect(
        200,
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body.data.context).toBe(context);
      expect(response.body.data.options[group]).toContainEqual(
        expect.objectContaining({ value }),
      );
      if (context !== 'reports') {
        await sql('UPDATE form_options SET active=false WHERE context=$1', [
          context,
        ]);
        expect(
          (await get(`/api/form-options?context=${context}`)).body.data.options[
            group
          ],
        ).toEqual([]);
      }
    },
  );
  it('does not require network.read for paginated eligible pharmacies and excludes unknown activity', async () => {
    const first = await get(
      '/api/prescriptions/pharmacies?page=1&limit=1',
    ).expect(200);
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2 });
    expect(first.body.data.items[0]).toMatchObject({
      id: id(2),
      name: 'Named pharmacy',
      status: 'ACTIVE',
      verified: true,
    });
    expect(
      (await get('/api/prescriptions/pharmacies?page=2&limit=1')).body.data
        .items[0].id,
    ).toBe(id(3));
    expect(
      (await get('/api/prescriptions/pharmacies?page=3&limit=1')).body.data
        .items,
    ).toEqual([]);
    await sql("UPDATE users SET verification_status='REJECTED' WHERE id=$1", [
      id(12),
    ]);
    expect(
      (await get('/api/prescriptions/pharmacies')).body.data.pagination.total,
    ).toBe(1);
    await get('/api/prescriptions/pharmacies', 11).expect(403);
  });
  it('binds the prescriber to the doctor and preserves the selected pharmacy', async () => {
    const response = await post('/api/prescriptions', prescription()).expect(
      201,
    );
    expect(response.body.data).toMatchObject({
      pharmacy_facility_id: id(2),
      prescriber_id: id(10),
      insurer: 'reviewed-plan',
      qty: 2,
      pharmacy: { id: id(2), name: 'Named pharmacy' },
      pharmacy_name: 'Named pharmacy',
      prescriber: { id: id(10), name: 'Recorded Clinician' },
    });
    const refreshed = await get('/api/prescriptions').expect(200);
    expect(refreshed.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: response.body.data.id,
          patient_ref: 'patient-pseudonym',
          icd10: 'C50.9',
          insurer: 'reviewed-plan',
          pharmacy: {
            id: id(2),
            name: 'Named pharmacy',
            city: 'Ikeja',
            state: null,
            status: 'ACTIVE',
          },
          pharmacy_name: 'Named pharmacy',
          prescriber: { id: id(10), name: 'Recorded Clinician' },
          auth_status: 'Pending',
          order_stage: 'Waiting',
        }),
      ]),
    );
    expect(
      (await sql('SELECT count(*)::int count FROM order_events'))[0].count,
    ).toBe(1);
    await post('/api/prescriptions', {
      ...prescription(),
      prescriber_id: id(11),
    }).expect(403);
    expect(
      (await sql('SELECT count(*)::int count FROM prescriptions'))[0].count,
    ).toBe(1);
  });
  it.each([
    ' c50 ',
    'c50.9',
    ' C50.91\n',
    ' d05.1 ',
    'C50.999',
    'C50.9 Breast cancer',
  ])(
    'normalizes ICD-10 code %j before validation and persistence',
    async (icd10) => {
      const response = await post('/api/prescriptions', {
        ...prescription(),
        icd10,
      }).expect(201);
      expect(response.body.data.icd10).toBe(icd10.trim().toUpperCase());
      expect((await sql('SELECT icd10 FROM prescriptions'))[0].icd10).toBe(
        icd10.trim().toUpperCase(),
      );
    },
  );
  it.each(
    ['', '   ', null, 50, ['C50.9'], 'C'.repeat(201)].map((icd10) => [icd10]),
  )('rejects empty, non-string or oversized ICD-10 input %j', async (icd10) => {
    const response = await post('/api/prescriptions', {
      ...prescription(),
      icd10,
    }).expect(422);
    expect(response.body.message).toContain(
      'Enter an ICD-10 value between 1 and 200 characters.',
    );
    expect(await sql('SELECT id FROM prescriptions')).toEqual([]);
  });
  it('normalizes ICD-10 updates and rejects malformed codes without changing the saved code', async () => {
    const created = await post('/api/prescriptions', prescription()).expect(
      201,
    );
    const url = `/api/prescriptions/${created.body.data.id}`;
    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token(11))
      .send({ icd10: ' d05.1 ' })
      .expect(200);
    expect((await sql('SELECT icd10 FROM prescriptions'))[0].icd10).toBe(
      'D05.1',
    );
    const invalid = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', token(11))
      .send({ icd10: ['C50.9'] })
      .expect(422);
    expect(invalid.body.code).toBe('INVALID_ICD10');
    expect((await sql('SELECT icd10 FROM prescriptions'))[0].icd10).toBe(
      'D05.1',
    );
  });
  const reviewAccess = async (review = true) => {
    await sql(
      "INSERT INTO role_permissions(role_id,permission) VALUES (3,'prescription.read')",
    );
    if (review)
      await sql(
        "INSERT INTO role_permissions(role_id,permission) VALUES (3,'prescription.review')",
      );
  };
  const reviewGet = (url: string, n = 13) => get(url, n);
  it('persists an optional description across creation, lists and review, and revisions change when it is edited', async () => {
    await reviewAccess();
    const created = (
      await post('/api/prescriptions', {
        ...prescription(),
        description: '  Recorded prescription instructions.  ',
      }).expect(201)
    ).body.data;
    expect(created.description).toBe('Recorded prescription instructions.');
    expect(
      (await get('/api/prescriptions').expect(200)).body.data.items[0]
        .description,
    ).toBe(created.description);
    const url = `/admin/api/prescriptions/${created.id}`;
    expect((await reviewGet(url).expect(200)).body.data.description).toBe(
      created.description,
    );
    await request(app.getHttpServer())
      .patch(`/api/prescriptions/${created.id}`)
      .set('Authorization', token())
      .send({ description: 'Changed instructions.' })
      .expect(200);
    expect((await reviewGet(url).expect(200)).body.data).toMatchObject({
      description: 'Changed instructions.',
      version: 2,
    });
    await post(
      `${url}/decision`,
      { decision: 'APPROVE', expectedVersion: 1, reason: 'Stale draft' },
      13,
    ).expect(409);
    const reviewed = await post(
      `${url}/decision`,
      { decision: 'APPROVE', expectedVersion: 2, reason: 'Reviewed' },
      13,
    ).expect(200);
    expect(reviewed.body.data.description).toBe('Changed instructions.');
  });
  it('allows missing/blank descriptions and rejects non-text or oversized descriptions', async () => {
    for (const description of [undefined, '   ', null]) {
      const created = await post('/api/prescriptions', {
        ...prescription(),
        description,
      }).expect(201);
      expect(created.body.data.description).toBeNull();
    }
    for (const description of [42, 'x'.repeat(2001)])
      await post('/api/prescriptions', {
        ...prescription(),
        description,
      }).expect(422);
  });
  it('enforces existing MFA requirements on prescription review routes', async () => {
    await reviewAccess();
    const previous = process.env.ADMIN_MFA_REQUIRED;
    process.env.ADMIN_MFA_REQUIRED = 'true';
    try {
      await reviewGet('/admin/api/prescriptions').expect(403);
      await request(app.getHttpServer())
        .get('/admin/api/prescriptions')
        .set('Authorization', `Bearer ${jwt.sign({ id: id(13), mfa: true })}`)
        .expect(200);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_MFA_REQUIRED;
      else process.env.ADMIN_MFA_REQUIRED = previous;
    }
  });
  it('returns saved prescription review fields, canonical legacy approvals, filters and authorized pagination', async () => {
    await reviewAccess();
    const created = (
      await post('/api/prescriptions', prescription()).expect(201)
    ).body.data;
    const list = await reviewGet(
      '/admin/api/prescriptions?authStatus=Pending&q=Named%20pharmacy&limit=1',
    ).expect(200);
    expect(list.body.data).toMatchObject({
      items: [
        {
          id: created.id,
          patient_ref: 'patient-pseudonym',
          insurer: 'reviewed-plan',
          pharmacy: { name: 'Named pharmacy' },
          medicine: { name: 'Named medicine' },
          prescriber: { name: 'Recorded Clinician' },
        },
      ],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
    const detail = await reviewGet(
      `/admin/api/prescriptions/${created.id}`,
    ).expect(200);
    expect(detail.body.data).toMatchObject({
      version: 1,
      allowedDecisions: ['APPROVE', 'REJECT'],
      events: [
        { type: 'Prescription Created', actorName: 'Recorded Clinician' },
      ],
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /password|email|phone|payload|secret/i,
    );
    const empty = await reviewGet(
      '/admin/api/prescriptions?q=not-present',
    ).expect(200);
    expect(empty.body.data).toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    await reviewGet('/admin/api/prescriptions?limit=101').expect(400);
    await reviewGet('/admin/api/prescriptions?authStatus=Cleared').expect(400);
    await sql("UPDATE prescriptions SET auth_status='Cleared' WHERE id=$1", [
      created.id,
    ]);
    expect(
      (
        await reviewGet('/admin/api/prescriptions?authStatus=Approved').expect(
          200,
        )
      ).body.data.items[0].auth_status,
    ).toBe('Approved');
    expect(
      (await reviewGet(`/admin/api/prescriptions/${created.id}`).expect(200))
        .body.data.allowedDecisions,
    ).toEqual([]);
  });
  it('requires network scope and explicit read/review grants even for direct API calls', async () => {
    const created = (
      await post('/api/prescriptions', prescription()).expect(201)
    ).body.data;
    const url = `/admin/api/prescriptions/${created.id}`;
    await request(app.getHttpServer()).get(url).expect(401);
    await reviewGet(url, 10).expect(403);
    await reviewGet(url).expect(403);
    await reviewAccess(false);
    expect(
      (await reviewGet(url).expect(200)).body.data.allowedDecisions,
    ).toEqual([]);
    await post(
      `${url}/decision`,
      { decision: 'APPROVE', expectedVersion: 1, reason: 'Reviewed' },
      13,
    ).expect(403);
    await sql(
      "INSERT INTO role_permissions(role_id,permission) VALUES (3,'prescription.review')",
    );
    await sql("UPDATE roles SET name='FACILITY_ADMIN' WHERE id=3");
    await reviewGet(url).expect(403);
    await post(
      `${url}/decision`,
      { decision: 'APPROVE', expectedVersion: 1, reason: 'Reviewed' },
      13,
    ).expect(403);
  });
  it.each(['APPROVE', 'REJECT'])(
    'records %s once without changing clinical, pharmacy or dispensing fields',
    async (decision) => {
      await reviewAccess();
      const created = (
        await post('/api/prescriptions', prescription()).expect(201)
      ).body.data;
      const url = `/admin/api/prescriptions/${created.id}`;
      const response = await post(
        `${url}/decision`,
        {
          decision,
          expectedVersion: 1,
          reason: '  Recorded local authorization review.  ',
        },
        13,
      ).expect(200);
      expect(response.body.data).toMatchObject({
        version: 2,
        auth_status: decision === 'APPROVE' ? 'Approved' : 'Rejected',
        order_stage: 'Waiting',
        patient_ref: created.patient_ref,
        icd10: created.icd10,
        insurer: created.insurer,
        qty: created.qty,
        pharmacy: { id: created.pharmacy_facility_id },
        allowedDecisions: [],
      });
      expect(response.body.data.events).toHaveLength(2);
      expect(response.body.data.events[1]).toMatchObject({
        type: decision,
        message: 'Recorded local authorization review.',
        actorName: 'Recorded Clinician',
      });
      await post(
        `${url}/decision`,
        { decision, expectedVersion: 2, reason: 'Repeat' },
        13,
      ).expect(409);
      expect(
        await sql(
          "SELECT id FROM audit_logs WHERE action='PRESCRIPTION_REVIEWED'",
        ),
      ).toHaveLength(1);
      expect(
        (await sql('SELECT quantity FROM inventory WHERE id=$1', [id(20)]))[0]
          .quantity,
      ).toBe(0);
      const own = await get('/api/prescriptions').expect(200);
      expect(own.body.data.items[0].auth_status).toBe(
        decision === 'APPROVE' ? 'Approved' : 'Rejected',
      );
    },
  );
  it('serializes reviewers racing the same version into one decision and one conflict', async () => {
    await reviewAccess();
    const created = (
      await post('/api/prescriptions', prescription()).expect(201)
    ).body.data;
    const results = await Promise.all(
      ['APPROVE', 'REJECT'].map((decision) =>
        post(
          `/admin/api/prescriptions/${created.id}/decision`,
          { decision, expectedVersion: 1, reason: 'Reviewed' },
          13,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await sql('SELECT id FROM order_events WHERE review_version IS NOT NULL'),
    ).toHaveLength(1);
    expect(
      await sql(
        "SELECT id FROM audit_logs WHERE action='PRESCRIPTION_REVIEWED'",
      ),
    ).toHaveLength(1);
  });
  it('protects generic PATCH against self-approval and protected-field writes and invalidates stale review drafts after clinical edits', async () => {
    await reviewAccess();
    const created = (
      await post('/api/prescriptions', prescription()).expect(201)
    ).body.data;
    const patch = (body: object) =>
      request(app.getHttpServer())
        .patch(`/api/prescriptions/${created.id}`)
        .set('Authorization', token())
        .send(body);
    for (const body of [
      { auth_status: 'Approved' },
      { order_stage: 'Dispensed' },
      { version: 99 },
      { prescriber_id: id(11) },
      { pharmacy_facility_id: id(3) },
    ])
      await patch(body).expect(403);
    await patch({ icd10: ' d05.1 ' }).expect(200);
    expect(
      (await reviewGet(`/admin/api/prescriptions/${created.id}`).expect(200))
        .body.data.version,
    ).toBe(2);
    await post(
      `/admin/api/prescriptions/${created.id}/decision`,
      { decision: 'APPROVE', expectedVersion: 1, reason: 'Old draft' },
      13,
    ).expect(409);
    await post(
      `/admin/api/prescriptions/${created.id}/decision`,
      {
        decision: 'APPROVE',
        expectedVersion: 2,
        reason: 'Reviewed current record',
      },
      13,
    ).expect(200);
    await patch({ icd10: 'changed' }).expect(409);
  });
  it.each(['medicine', 'pharmacy', 'prescriber', 'stage'])(
    'withholds decisions and rejects changed eligibility: %s',
    async (kind) => {
      await reviewAccess();
      const created = (
        await post('/api/prescriptions', prescription()).expect(201)
      ).body.data;
      if (kind === 'medicine')
        await sql('UPDATE medicines SET deleted_at=now()');
      if (kind === 'pharmacy')
        await sql("UPDATE hospitals SET status='SUSPENDED' WHERE id=$1", [
          id(2),
        ]);
      if (kind === 'prescriber')
        await sql('UPDATE users SET active=false WHERE id=$1', [id(10)]);
      if (kind === 'stage')
        await sql("UPDATE prescriptions SET order_stage='Dispensed'");
      const detail = (
        await reviewGet(`/admin/api/prescriptions/${created.id}`).expect(200)
      ).body.data;
      expect(detail.allowedDecisions).toEqual([]);
      await post(
        `/admin/api/prescriptions/${created.id}/decision`,
        {
          decision: 'APPROVE',
          expectedVersion: detail.version,
          reason: 'Review',
        },
        13,
      ).expect(409);
      expect(
        await sql(
          "SELECT id FROM audit_logs WHERE action='PRESCRIPTION_REVIEWED'",
        ),
      ).toEqual([]);
    },
  );
  it('validates decision bodies, missing records and rolls back decisions if audit persistence fails', async () => {
    await reviewAccess();
    const created = (
      await post('/api/prescriptions', prescription()).expect(201)
    ).body.data;
    const url = `/admin/api/prescriptions/${created.id}/decision`;
    for (const body of [
      { decision: 'APPROVE', expectedVersion: 1, reason: ' ' },
      { decision: 'UNKNOWN', expectedVersion: 1, reason: 'Review' },
      { decision: 'APPROVE', expectedVersion: 0, reason: 'Review' },
      {
        decision: 'APPROVE',
        expectedVersion: 1,
        reason: 'Review',
        auth_status: 'Approved',
      },
    ])
      await post(url, body, 13).expect(400);
    await reviewGet(`/admin/api/prescriptions/${id(999)}`).expect(404);
    await pg.exec(
      `CREATE FUNCTION fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_review_audit();`,
    );
    try {
      await post(
        url,
        { decision: 'APPROVE', expectedVersion: 1, reason: 'Review' },
        13,
      ).expect(500);
      expect(
        (
          await sql(
            'SELECT auth_status,version FROM prescriptions WHERE id=$1',
            [created.id],
          )
        )[0],
      ).toMatchObject({ auth_status: 'Pending', version: 1 });
      expect(
        await sql(
          'SELECT id FROM order_events WHERE review_version IS NOT NULL',
        ),
      ).toEqual([]);
    } finally {
      await pg.exec(
        'DROP TRIGGER fail_review_audit ON audit_logs; DROP FUNCTION fail_review_audit()',
      );
    }
    await expect(
      sql("UPDATE order_events SET step='overwrite'"),
    ).rejects.toThrow();
  });
  it('rechecks managed choices, medicine state, and pharmacy eligibility at submission', async () => {
    await sql(
      "UPDATE form_options SET active=false WHERE context='prescription'",
    );
    const denied = await post('/api/prescriptions', prescription()).expect(422);
    expect(denied.body.code).toBe('OPTION_UNAVAILABLE');
    await sql(
      "UPDATE form_options SET active=true WHERE context='prescription'",
    );
    await post('/api/prescriptions', {
      ...prescription(),
      pharmacy_facility_id: id(4),
    }).expect(422);
    await sql('UPDATE medicines SET deleted_at=now()');
    await post('/api/prescriptions', prescription()).expect(422);
    expect(await sql('SELECT id FROM prescriptions')).toEqual([]);
    await post('/api/prescriptions', { ...prescription(), qty: 1.5 }).expect(
      422,
    );
  });
  it('rolls back the prescription when its event cannot persist', async () => {
    await pg.exec(`CREATE FUNCTION fail_order_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event failed'; END $$;
      CREATE TRIGGER failed_event BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION fail_order_event();`);
    try {
      await post('/api/prescriptions', prescription()).expect(500);
      expect(await sql('SELECT id FROM prescriptions')).toEqual([]);
    } finally {
      await pg.exec(
        'DROP TRIGGER failed_event ON order_events; DROP FUNCTION fail_order_event()',
      );
    }
  });
  it.each(['CSV', 'PDF', 'XLSX'])(
    'returns real %s bytes scoped to the facility and records an audit',
    async (type) => {
      const response = await post('/api/reports/export', { type }).expect(201);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const data = response.body.data as {
        contentBase64: string;
        fileName: string;
        mimeType: string;
        csv?: string;
      };
      const bytes = Buffer.from(data.contentBase64, 'base64');
      expect(data.fileName).toMatch(/^inventory-[\w.-]+\.(csv|pdf|xlsx)$/);
      if (type === 'CSV') {
        expect(data.mimeType).toBe('text/csv');
        expect(bytes.toString()).toBe(data.csv);
        expect(data.csv).toContain('OWN-LOT');
        expect(data.csv).not.toContain('OTHER-LOT');
        expect(data.csv).toContain('"0"');
      } else if (type === 'PDF') {
        expect(data.mimeType).toBe('application/pdf');
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        expect(bytes.subarray(-20).toString()).toContain('%%EOF');
      } else {
        const workbook = new Workbook();
        await workbook.xlsx.load(bytes as never);
        expect(workbook.worksheets[0].rowCount).toBe(2);
        expect(workbook.worksheets[0].getRow(2).getCell(4).value).toBe(
          'OWN-LOT',
        );
        expect(workbook.worksheets[0].getRow(2).getCell(6).value).toBe(0);
      }
      expect(await sql('SELECT action FROM audit_logs')).toEqual([
        { action: 'REPORT_EXPORTED' },
      ]);
    },
  );
  it('validates export permission, dates and formats and honors network scope only with grants', async () => {
    await post('/api/reports/export', { type: 'CSV' }, 11).expect(403);
    await post('/api/reports/export', {
      type: 'CSV',
      from: '2026-02-30',
    }).expect(422);
    await post('/api/reports/export', {
      type: 'CSV',
      from: '2026-10-22',
      to: '2026-10-21',
    }).expect(422);
    await post('/api/reports/export', { type: 'FAKE' }).expect(422);
    await post('/api/reports/export', {
      type: 'CSV',
      facilityId: id(2),
    }).expect(422);
    const network = await post(
      '/api/reports/export',
      { type: 'CSV' },
      13,
    ).expect(201);
    expect(network.body.data.csv).toContain('OTHER-LOT');
    const empty = await post('/api/reports/export', {
      type: 'CSV',
      from: '2000-01-01',
      to: '2000-01-01',
    }).expect(201);
    expect(empty.body.data.csv.split('\r\n')).toHaveLength(1);
    await sql("DELETE FROM role_permissions WHERE permission='report.export'");
    await get('/api/form-options?context=reports').expect(403);
    await post('/api/reports/export', { type: 'CSV' }).expect(403);
  });
  it('escapes CSV quotes and neutralizes spreadsheet formula text', () => {
    expect(reportCsv([['=HYPERLINK("x")', null, 0]])).toContain(
      '"\'=HYPERLINK(""x"")","","0"',
    );
  });
  it('revalidates managed currencies atomically and permits clearing without a default', async () => {
    const put = (body: object) =>
      request(app.getHttpServer())
        .put('/api/settings')
        .set('Authorization', token())
        .send(body);
    expect(
      (await put({ currency: ' zar ', threshold: 0 }).expect(200)).body,
    ).toEqual({ currency: 'ZAR', threshold: 0 });
    await put({ currency: 'USD', threshold: 99 }).expect(422);
    expect(
      (await sql("SELECT value FROM settings WHERE key='threshold'"))[0].value,
    ).toBe(0);
    await sql("UPDATE form_options SET active=false WHERE context='settings'");
    await put({ currency: 'ZAR' }).expect(422);
    expect((await put({ currency: '' }).expect(200)).body).toEqual({
      currency: null,
      threshold: 0,
    });
  });
  it('does not advertise invalid configured currency identifiers', async () => {
    await sql(
      "INSERT INTO form_options(context,value,label) VALUES ('settings','INVALID','Invalid configuration')",
    );
    const response = await get('/api/form-options?context=settings').expect(
      503,
    );
    expect(response.body.code).toBe('OPTIONS_CONFIGURATION_INVALID');
  });
  it('retains required network MFA checks for exports and option metadata', async () => {
    const previous = process.env.ADMIN_MFA_REQUIRED;
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const guard = new OperationalReadGuard(new NetworkAdminGuard(db));
    const actor = { id: id(13), role: 'ADMIN', amr: [] as string[] };
    const context = (method: string, path: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ method, path, user: actor }),
        }),
      }) as unknown as ExecutionContext;
    try {
      await expect(
        guard.canActivate(context('POST', '/api/reports/export')),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        guard.canActivate(context('GET', '/api/form-options')),
      ).rejects.toMatchObject({ status: 403 });
      actor.amr = ['mfa'];
      expect(
        await guard.canActivate(context('POST', '/api/reports/export')),
      ).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_MFA_REQUIRED;
      else process.env.ADMIN_MFA_REQUIRED = previous;
    }
  });
});
