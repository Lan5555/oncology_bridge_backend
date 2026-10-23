import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OperationalReadsService } from './operational-reads.service';
import { OperationalResource, READ_PERMISSIONS } from './operational-resources';
import { OperationalQueryDto } from './operational-query.dto';
import { AdminMarketplaceReadController } from './operational-reads.controller';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { OperationalReadGuard } from '../guards/operational-read.guard';
import { InventoryManagementGuard } from '../guards/inventory-management.guard';
import { MedicineCatalogGuard } from '../guards/medicine-catalog.guard';
import { StockAccessService } from '../guards/stock-access.service';
import { NetResponseFilter } from '../helpers/net-response.filter';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { MedicineController } from '../medicine/medicine.controller';
import { MedicineService } from '../medicine/medicine.service';
import {
  InventoryController,
  ExpiryController,
} from '../inventory/inventory.controller';
import { InventoryService } from '../inventory/inventory.service';
import { PrescriptionsController } from '../prescriptions/prescriptions.controller';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { InvoicesController } from '../invoices/invoices.controller';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceAuthGuard } from '../invoices/invoice-auth.guard';
import { TransferRequestsController } from '../transfer_requests/transfer_requests.controller';
import { TransferRequestsService } from '../transfer_requests/transfer_requests.service';
import { ScanLogController } from '../scan_log/scan_log.controller';
import { ScanLogService } from '../scan_log/scan_log.service';
import { Gs1ImageDecoderService } from '../scan_log/gs1-image-decoder.service';
import { StorageUnitsController } from '../storage_units/storage-units.controller';
import { StorageUnitsService } from '../storage_units/storage-units.service';
import { ColdChainEventsController } from '../cold_chain_events/cold-chain-events.controller';
import { NetworkApiController } from '../hospital/hospital.controller';
import { ResearchInquiriesController } from '../research_inquiries/research-inquiries.controller';
import { ResearchInquiriesService } from '../research_inquiries/research-inquiries.service';

jest.setTimeout(60000);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const endpoints: [OperationalResource, string][] = [
  ['medicines', '/api/medicines'],
  ['inventory', '/api/inventory'],
  ['marketplace', '/admin/api/marketplace/listings'],
  ['prescriptions', '/api/prescriptions'],
  ['invoices', '/api/invoices'],
  ['transfers', '/api/transfers'],
  ['scans', '/api/scans'],
  ['storage', '/api/storage-units'],
  ['events', '/api/cold-chain-events'],
  ['expiry', '/api/expiry?withinDays=60'],
  ['network', '/api/network'],
  ['research', '/api/research/inquiries'],
];
// Transfers now return the complete matching list with custody actions; their
// HTTP scoping and list contract are covered in redistribution-selection.spec.ts.
const paginatedEndpoints = endpoints.filter(
  ([resource]) => resource !== 'transfers',
);

describe('operational reads with real JWTs and PostgreSQL queries', () => {
  let pg: PGlite, app: INestApplication, reads: OperationalReadsService;
  let adminToken: string,
    facilityToken: string,
    superToken: string,
    deniedToken: string;
  let failDatabase = false;
  type TestActor = {
    id: string;
    active: boolean;
    role: { id: number; name: string };
    hospital: { id: string; status: string; ip_whitelist: string[] };
    account_type: string;
    verification_status: string;
  };
  const actors = new Map<string, TestActor>();
  const sql = async (text: string, args: unknown[] = []) =>
    (await pg.query(text, args)).rows as Record<string, unknown>[];
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE roles(id int PRIMARY KEY,name text);
      INSERT INTO roles VALUES (1,'ADMIN'),(2,'SUPERADMIN'),(3,'FACILITY_ADMIN'),(4,'ADMIN');
      CREATE TABLE role_permissions(id uuid DEFAULT gen_random_uuid(),role_id int,permission text,UNIQUE(role_id,permission));
      INSERT INTO role_permissions(role_id,permission) VALUES (1,'admin.access'),(2,'admin.access'),(4,'admin.access');
      CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,state text,status text,deleted_at timestamptz,
        hospital_code text,facility_type text,address text,latitude numeric,longitude numeric,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE users(id uuid PRIMARY KEY,hospital_id uuid,email text,password_hash text,refresh_token text,first_name text,last_name text);
      CREATE TABLE medicines(id uuid PRIMARY KEY,gtin text,generic_name text,brand_name text,manufacturer text,strength text,
        dosage_form text,storage_temperature text,prescription_required boolean,catalog_facility_id uuid,created_at timestamptz DEFAULT now(),deleted_at timestamptz);
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,batch_number text,serial_number text,
        expiry_date date,quantity int,status text,selling_unit text,storage_unit_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE marketplace_listings(id uuid PRIMARY KEY,inventory_item_id uuid,facility_id uuid,creator_id uuid,category text,unit text,
        price_kobo bigint,quantity int,description text,storage text,prescription_required boolean,status text,
        created_at timestamptz DEFAULT now(),CONSTRAINT marketplace_listings_status_check CHECK(status IN ('PUBLISHED','PENDING_REVIEW','SUSPENDED')));
      CREATE TABLE marketplace_listing_images(id uuid PRIMARY KEY,listing_id uuid,url text,alt text,position int);
      CREATE TABLE prescriptions(id uuid PRIMARY KEY,display_id text,patient_ref text,drug_id uuid,qty int,icd10 text,description text,tnm_stage text,
        insurer text,pharmacy_facility_id uuid,auth_status text,order_stage text,prescriber_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE invoices(id uuid PRIMARY KEY,reference text,order_id uuid,pharmacy_facility_id uuid,status text,total_naira numeric,
        paystack_reference text,paid_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE invoice_items(id uuid PRIMARY KEY,invoice_id uuid,description text,quantity int,unit_price_naira numeric);
      CREATE TABLE marketplace_orders(id uuid PRIMARY KEY,invoice_reference text,facility_id uuid,payment_status text,total_kobo bigint,
        payment_reference text,paid_at timestamptz,created_at timestamptz DEFAULT now(),buyer_id uuid,snapshot jsonb,quantity int,unit_price_kobo bigint,
        authorization_url text,inventory_item_id uuid,reservation_state text,expires_at timestamptz);
      CREATE TABLE transfer_requests(id uuid PRIMARY KEY,from_hospital uuid,to_hospital uuid,medicine_id uuid,inventory_id uuid,quantity int,status text,
        approved_at timestamptz,created_at timestamptz DEFAULT now(),selling_unit text);
      CREATE TABLE scan_logs(id uuid PRIMARY KEY,inventory_id uuid,facility_id uuid,scanned_by uuid,gtin text,batch_number text,serial_number text,
        expiry_date date,action text,result text,created_at timestamptz DEFAULT now(),client_ts timestamptz,notes text);
      CREATE TABLE storage_units(id uuid PRIMARY KEY,facility_id uuid,label text,kind text,target_min numeric,target_max numeric,
        offline_after_seconds int,operational_state text,last_seen_at timestamptz,created_at timestamptz DEFAULT now(),device_key text);
      CREATE TABLE temperature_logs(id uuid PRIMARY KEY,unit_id uuid,temperature numeric,recorded_at timestamptz DEFAULT now());
      CREATE TABLE cold_chain_events(id uuid PRIMARY KEY,unit_id uuid,severity text,message text,action_taken text,state text,at timestamptz DEFAULT now(),
        last_seen_at timestamptz,resolved_at timestamptz,observed_min_celsius numeric,observed_max_celsius numeric,affected_inventory_ids jsonb);
      CREATE TABLE research_inquiries(id uuid PRIMARY KEY,name text,organisation text,email text,message text,created_at timestamptz DEFAULT now());
    `);
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/admin-operational-reads.sql'),
        'utf8',
      ),
    );
    // The migration grants both network roles, but never facility-admin roles.
    expect(
      (
        await sql(
          "SELECT count(*)::int total FROM role_permissions WHERE role_id IN (1,2) AND permission<>'admin.access'",
        )
      )[0].total,
    ).toBe(20);
    expect(await sql('SELECT * FROM role_permissions WHERE role_id=3')).toEqual(
      [],
    );
    // A fourth operator deliberately has no operational read grants.
    await sql(
      'DELETE FROM role_permissions WHERE role_id=4 AND permission<>$1',
      ['admin.access'],
    );
    for (const n of [1, 2]) {
      const label = n === 1 ? 'Alpha' : 'Beta';
      await sql(
        `INSERT INTO hospitals(id,name,city,state,status,hospital_code,facility_type,address) VALUES ($1,$2,'Lagos','Lagos','ACTIVE',$2,'PHARMACY','Business address')`,
        [id(n), label],
      );
      await sql(
        'INSERT INTO users(id,hospital_id,email,password_hash,refresh_token) VALUES ($1,$2,$3,$4,$5)',
        [
          id(10 + n),
          id(n),
          'encrypted-email',
          'PASSWORD-MUST-NOT-LEAK',
          'REFRESH-MUST-NOT-LEAK',
        ],
      );
      await sql(
        `INSERT INTO medicines(id,gtin,generic_name,brand_name,manufacturer,strength,dosage_form,storage_temperature,prescription_required,catalog_facility_id)
        VALUES ($1,$2,$3,$3,'Maker','10mg','vial','2-8 C',true,$4)`,
        [id(20 + n), `gtin-${n}`, label, id(n)],
      );
      await sql(
        `INSERT INTO inventory(id,hospital_id,medicine_id,batch_number,serial_number,expiry_date,quantity,status,selling_unit)
        VALUES ($1,$2,$3,$4,$4,CURRENT_DATE+30,10,'AVAILABLE','vial')`,
        [id(30 + n), id(n), id(20 + n), label],
      );
      await sql(
        `INSERT INTO prescriptions(id,display_id,patient_ref,drug_id,qty,icd10,pharmacy_facility_id,auth_status,order_stage,prescriber_id)
        VALUES ($1,$2,'PATIENT-PSEUDONYM',$3,2,'C50',$4,'Approved','Waiting',$5)`,
        [id(40 + n), label, id(20 + n), id(n), id(10 + n)],
      );
      await sql(
        `INSERT INTO invoices(id,reference,order_id,pharmacy_facility_id,status,total_naira,paystack_reference)
        VALUES ($1,$2,$3,$4,'AWAITING_PAYMENT',1250.25,$2)`,
        [id(50 + n), label, id(40 + n), id(n)],
      );
      await sql(`INSERT INTO invoice_items VALUES ($1,$2,$3,1,1250.25)`, [
        id(60 + n),
        id(50 + n),
        label,
      ]);
      await sql(
        `INSERT INTO transfer_requests(id,from_hospital,to_hospital,medicine_id,inventory_id,quantity,status) VALUES ($1,$2,$2,$3,$4,1,'PENDING')`,
        [id(70 + n), id(n), id(20 + n), id(30 + n)],
      );
      await sql(
        `INSERT INTO scan_logs(id,inventory_id,facility_id,scanned_by,gtin,batch_number,serial_number,expiry_date,action,result)
        VALUES ($1,$2,$3,$4,$5,$5,$5,CURRENT_DATE+30,'NEW','CLEAN')`,
        [id(80 + n), id(30 + n), id(n), id(10 + n), label],
      );
      await sql(
        `INSERT INTO storage_units(id,facility_id,label,kind,target_min,target_max,offline_after_seconds,operational_state,device_key)
        VALUES ($1,$2,$3,'FRIDGE',2,8,900,'UNKNOWN','DEVICE-SECRET-MUST-NOT-LEAK')`,
        [id(90 + n), id(n), label],
      );
      await sql(
        'INSERT INTO temperature_logs(id,unit_id,temperature) VALUES ($1,$2,4)',
        [id(100 + n), id(90 + n)],
      );
      await sql(
        `INSERT INTO cold_chain_events(id,unit_id,severity,message,state) VALUES ($1,$2,'WARNING',$3,'OPEN')`,
        [id(110 + n), id(90 + n), label],
      );
      await sql(
        'INSERT INTO research_inquiries(id,name,organisation,email,message) VALUES ($1,$2,$2,$3,$2)',
        [id(120 + n), label, 'researcher@example.test'],
      );
    }
    for (const [index, state] of [
      'DRAFT',
      'PENDING_REVIEW',
      'PUBLISHED',
      'SUSPENDED',
      'WITHDRAWN',
    ].entries()) {
      await sql(
        `INSERT INTO marketplace_listings(id,inventory_item_id,facility_id,creator_id,category,unit,price_kobo,quantity,description,storage,prescription_required,status)
        VALUES ($1,$2,$3,$4,'Biologics','vial',125025,10,$5,'2-8 C',true,$6)`,
        [
          id(200 + index),
          id(31 + (index % 2)),
          id(1 + (index % 2)),
          id(11 + (index % 2)),
          index % 2 === 0 ? 'Alpha' : 'Beta',
          state,
        ],
      );
      await sql(
        'INSERT INTO marketplace_listing_images VALUES ($1,$2,$3,$4,0)',
        [
          id(300 + index),
          id(200 + index),
          'https://res.cloudinary.com/example/medicine.webp',
          'Packaging',
        ],
      );
    }
    await sql(
      `INSERT INTO marketplace_orders(id,invoice_reference,facility_id,payment_status,total_kobo,payment_reference,buyer_id,snapshot,quantity,unit_price_kobo,authorization_url)
      VALUES ($1,'OB-MARKET-Beta',$2,'PAID',125025,'payment-ref',$3,'{"name":"Beta","medicineId":"opaque-drug"}',1,125025,'PAYMENT-LINK-MUST-NOT-LEAK')`,
      [id(400), id(2), id(11)],
    );
    for (const [userId, roleId, role] of [
      [id(501), 1, 'ADMIN'],
      [id(502), 2, 'SUPERADMIN'],
      [id(503), 3, 'FACILITY_ADMIN'],
      [id(504), 4, 'ADMIN'],
    ] as const)
      actors.set(userId, {
        id: userId,
        active: true,
        role: { id: roleId, name: role },
        hospital: { id: id(1), status: 'ACTIVE', ip_whitelist: [] },
        account_type: 'PHARMACIST',
        verification_status: 'VERIFIED',
      });
    const getRepository = (entity: unknown) => {
      if (entity === User)
        return {
          findOne: async (options: { where: { id: string } }) =>
            actors.get(options.where.id) ?? null,
        };
      if (entity === RolePermission)
        return {
          findBy: async (where: { role_id: number }) =>
            sql('SELECT permission FROM role_permissions WHERE role_id=$1', [
              where.role_id,
            ]),
        };
      if (entity === VerificationApplication)
        return { findOne: async () => ({ status: 'VERIFIED' }) };
      throw new Error('Unexpected repository');
    };
    const db = {
      getRepository,
      transaction: async (
        _isolation: string,
        callback: (manager: unknown) => unknown,
      ) => {
        if (failDatabase) throw new Error('database offline');
        return pg.transaction(async (tx) =>
          callback({
            query: async (text: string, args: unknown[]) =>
              (await tx.query(text, args)).rows,
          }),
        );
      },
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'operational-test-secret' })],
      controllers: [
        MedicineController,
        InventoryController,
        ExpiryController,
        AdminMarketplaceReadController,
        PrescriptionsController,
        InvoicesController,
        TransferRequestsController,
        ScanLogController,
        StorageUnitsController,
        ColdChainEventsController,
        NetworkApiController,
        ResearchInquiriesController,
      ],
      providers: [
        OperationalReadsService,
        AuthGuard,
        NetworkAdminGuard,
        OperationalReadGuard,
        MedicineCatalogGuard,
        InventoryManagementGuard,
        InvoiceAuthGuard,
        { provide: DataSource, useValue: db },
        ...[
          MedicineService,
          InventoryService,
          PrescriptionsService,
          InvoicesService,
          TransferRequestsService,
          ScanLogService,
          Gs1ImageDecoderService,
          StorageUnitsService,
          ResearchInquiriesService,
          StockAccessService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
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
    reads = module.get(OperationalReadsService);
    const jwt = module.get(JwtService);
    [adminToken, superToken, facilityToken, deniedToken] = [
      501, 502, 503, 504,
    ].map((n) =>
      jwt.sign({ id: id(n), role: 'untrusted-role', facilityId: id(2) }),
    );
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });

  it.each(paginatedEndpoints)(
    '%s returns network-wide records from the explicit admin bearer, ignoring a facility cookie',
    async (_resource, path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Cookie', `session=${facilityToken}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(response.body).toMatchObject({
        success: true,
        data: { page: 1, limit: 25 },
      });
      expect(response.body.data.total).toBeGreaterThanOrEqual(2);
      const payload = JSON.stringify(response.body.data);
      expect(payload).toContain('Alpha');
      expect(payload).toContain('Beta');
      for (const secret of [
        'PASSWORD-MUST-NOT-LEAK',
        'REFRESH-MUST-NOT-LEAK',
        'DEVICE-SECRET-MUST-NOT-LEAK',
        'PAYMENT-LINK-MUST-NOT-LEAK',
      ])
        expect(payload).not.toContain(secret);
      expect(payload).not.toMatch(
        /password_hash|refresh_token|device_key|authorization_url|patient_name/,
      );
    },
  );
  it.each(endpoints)(
    '%s checks the corresponding read grant rather than navigation or JWT-supplied claims',
    async (_resource, path) => {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${deniedToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', `session=${adminToken}`)
        .expect(401);
    },
  );
  it.each(paginatedEndpoints)(
    '%s searches before stable pagination and returns filtered totals and empty states',
    async (_resource, path) => {
      const join = path.includes('?') ? '&' : '?';
      const get = (query: string) =>
        request(app.getHttpServer())
          .get(`${path}${join}${query}`)
          .set('Authorization', `Bearer ${adminToken}`);
      const first = await get('page=1&limit=1').expect(200);
      const second = await get('page=2&limit=1').expect(200);
      expect(first.body.data.total).toBe(second.body.data.total);
      expect(first.body.data.items[0].id).not.toBe(
        second.body.data.items[0].id,
      );
      const search = await get('q=Beta&page=1&limit=1').expect(200);
      expect(search.body.data.total).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(search.body.data.items)).toContain('Beta');
      const empty = await get('q=does-not-exist&page=1&limit=25').expect(200);
      expect(empty.body.data).toMatchObject({
        items: [],
        total: 0,
        page: 1,
        limit: 25,
      });
      const beyond = await get('page=100&limit=25').expect(200);
      expect(beyond.body.data.items).toEqual([]);
      expect(beyond.body.data.total).toBeGreaterThan(0);
    },
  );
  it.each(
    paginatedEndpoints.filter(
      ([resource]) => !['marketplace', 'research'].includes(resource),
    ),
  )(
    '%s keeps the facility bearer scoped even when an admin cookie is present',
    async (resource, path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Cookie', `session=${adminToken}`)
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      // A buyer facility can review its own marketplace invoice from a different supplier.
      if (resource !== 'invoices') {
        expect(response.body.data.total).toBe(1);
        expect(JSON.stringify(response.body.data.items)).not.toContain('Beta');
      } else expect(response.body.data.total).toBe(2);
      await request(app.getHttpServer())
        .get(`${path}${path.includes('?') ? '&' : '?'}facilityId=${id(2)}`)
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(403);
    },
  );
  it('includes all marketplace publication states and uploaded-image detail links', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/api/marketplace/listings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(new Set(response.body.data.items.map((row) => row.status))).toEqual(
      new Set([
        'DRAFT',
        'PENDING_REVIEW',
        'PUBLISHED',
        'SUSPENDED',
        'WITHDRAWN',
      ]),
    );
    expect(response.body.data.items[0]).toMatchObject({
      inventoryItemId: expect.any(String),
      unitPriceNaira: 1250.25,
      seller: { id: expect.any(String) },
      images: [{ url: expect.stringMatching(/^https:/) }],
    });
    await request(app.getHttpServer())
      .get('/admin/api/marketplace/listings')
      .set('Authorization', `Bearer ${facilityToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/research/inquiries')
      .set('Authorization', `Bearer ${facilityToken}`)
      .expect(403);
  });
  it('supports SUPERADMIN and honors configured network MFA', async () => {
    await request(app.getHttpServer())
      .get('/api/inventory')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    const previous = process.env.ADMIN_MFA_REQUIRED;
    process.env.ADMIN_MFA_REQUIRED = 'true';
    try {
      await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_MFA_REQUIRED;
      else process.env.ADMIN_MFA_REQUIRED = previous;
    }
  });
  it('filters deleted-medicine inventory and totals by default while preserving authorized historical reads', async () => {
    await sql('UPDATE medicines SET deleted_at=now() WHERE id=$1', [id(21)]);
    try {
      const getInventory = (query: string, token = facilityToken) =>
        request(app.getHttpServer())
          .get('/api/inventory' + query)
          .set('Authorization', `Bearer ${token}`);
      expect((await getInventory('').expect(200)).body.data).toMatchObject({
        total: 0,
        items: [],
      });
      const historical = await getInventory(
        '?includeDeletedMedicines=true',
      ).expect(200);
      expect(historical.body.data).toMatchObject({
        total: 1,
        items: [
          {
            medicine: {
              id: id(21),
              active: false,
              deleted_at: expect.any(String),
            },
            medicine_deleted: true,
            medicine_active: false,
          },
        ],
      });
      const otherSession = await getInventory('', superToken).expect(200);
      expect(
        otherSession.body.data.items.some(
          (row: any) => row.medicine?.id === id(21),
        ),
      ).toBe(false);
      await getInventory(
        '?includeDeletedMedicines=true&facilityId=' + id(2),
      ).expect(403);
      await getInventory('?includeDeletedMedicines=invalid').expect(400);
    } finally {
      await sql('UPDATE medicines SET deleted_at=NULL WHERE id=$1', [id(21)]);
    }
  });
  it('paginates named facility batches and reports stock available after transfer and checkout holds', async () => {
    await sql(
      `INSERT INTO inventory(id,hospital_id,medicine_id,batch_number,expiry_date,quantity,status,selling_unit,created_at)
      VALUES ($1,$2,$3,'SECOND-BATCH',CURRENT_DATE+40,5,'AVAILABLE','box','2000-01-01')`,
      [id(900), id(1), id(21)],
    );
    await sql(
      `INSERT INTO marketplace_orders(id,inventory_item_id,quantity,reservation_state,expires_at)
      VALUES ($1,$2,2,'RESERVED',now()+interval '15 minutes')`,
      [id(901), id(31)],
    );
    try {
      const first = await request(app.getHttpServer())
        .get('/api/inventory?page=1&limit=1')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      expect(first.body.data).toMatchObject({
        total: 2,
        page: 1,
        limit: 1,
        items: [
          {
            id: id(31),
            drug: 'Alpha',
            batch_number: 'Alpha',
            medicine: { generic_name: 'Alpha' },
            quantity: 10,
            availableQuantity: 7,
            unit: 'vial',
            facilityId: id(1),
          },
        ],
      });
      const second = await request(app.getHttpServer())
        .get('/api/inventory?page=2&limit=1')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      expect(second.body.data).toMatchObject({
        total: 2,
        page: 2,
        items: [
          {
            id: id(900),
            batch_number: 'SECOND-BATCH',
            quantity: 5,
            availableQuantity: 5,
            unit: 'box',
          },
        ],
      });
      await request(app.getHttpServer())
        .get(`/api/inventory?facilityId=${id(2)}`)
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(403);
    } finally {
      await sql('DELETE FROM marketplace_orders WHERE id=$1', [id(901)]);
      await sql('DELETE FROM inventory WHERE id=$1', [id(900)]);
    }
  });
  it('includes approved storage text unchanged in the inventory HTTP response', async () => {
    const approved = '  Store at 2?8?C.\nProtect from light.  ';
    await sql('UPDATE medicines SET storage_temperature=$1 WHERE id=$2', [
      approved,
      id(21),
    ]);
    try {
      const result = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      expect(result.body.data.items[0].medicine.storage_temperature).toBe(
        approved,
      );
    } finally {
      await sql(
        "UPDATE medicines SET storage_temperature='2-8 C' WHERE id=$1",
        [id(21)],
      );
    }
  });
  it('uses recorded measurement time and configured storage limits without nominal defaults', async () => {
    const unitId = id(91),
      readingId = id(101);
    const get = () =>
      request(app.getHttpServer())
        .get('/api/storage-units')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
    try {
      await sql(
        'UPDATE storage_units SET last_seen_at=now(),target_min=10,target_max=20 WHERE id=$1',
        [unitId],
      );
      await sql(
        'UPDATE temperature_logs SET temperature=0,recorded_at=now() WHERE id=$1',
        [readingId],
      );
      expect((await get()).body.data.items[0]).toMatchObject({
        currentC: 0,
        targetMin: 10,
        targetMax: 20,
        readingState: 'BREACH',
      });
      await sql('UPDATE storage_units SET target_min=0 WHERE id=$1', [unitId]);
      expect((await get()).body.data.items[0]).toMatchObject({
        currentC: 0,
        readingState: 'NOMINAL',
      });
      await sql('UPDATE storage_units SET target_min=NULL WHERE id=$1', [
        unitId,
      ]);
      expect((await get()).body.data.items[0]).toMatchObject({
        targetMin: null,
        targetMax: null,
        readingState: 'UNKNOWN',
      });
      await sql('UPDATE storage_units SET target_min=0 WHERE id=$1', [unitId]);
      await sql('UPDATE temperature_logs SET recorded_at=NULL WHERE id=$1', [
        readingId,
      ]);
      expect((await get()).body.data.items[0]).toMatchObject({
        currentC: null,
        currentReadingAt: null,
        readingState: 'UNKNOWN',
      });
      await sql(
        "UPDATE storage_units SET last_seen_at=now()-interval '1 hour' WHERE id=$1",
        [unitId],
      );
      expect((await get()).body.data.items[0].readingState).toBe('OFFLINE');
    } finally {
      await sql(
        'UPDATE storage_units SET last_seen_at=NULL,target_min=2,target_max=8 WHERE id=$1',
        [unitId],
      );
      await sql(
        'UPDATE temperature_logs SET temperature=4,recorded_at=now() WHERE id=$1',
        [readingId],
      );
    }
  });
  it('returns unknown availability for missing quantities while retaining genuine zero', async () => {
    try {
      await sql('UPDATE inventory SET quantity=NULL WHERE id=$1', [id(31)]);
      let response = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      expect(response.body.data.items[0]).toMatchObject({
        quantity: null,
        qty: null,
        availableQuantity: null,
      });
      await sql('UPDATE inventory SET quantity=0 WHERE id=$1', [id(31)]);
      response = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Authorization', `Bearer ${facilityToken}`)
        .expect(200);
      expect(response.body.data.items[0]).toMatchObject({
        quantity: 0,
        qty: 0,
        availableQuantity: 0,
      });
    } finally {
      await sql('UPDATE inventory SET quantity=10 WHERE id=$1', [id(31)]);
    }
  });
  it('caps catalogue page size and returns selectable fields and actual pagination metadata', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/medicines?page=1&limit=1000')
      .set('Authorization', `Bearer ${facilityToken}`)
      .expect(200);
    expect(result.body.data).toMatchObject({ page: 1, limit: 100, total: 1 });
    expect(result.body.data.items[0]).toMatchObject({
      id: id(21),
      generic_name: 'Alpha',
      brand_name: 'Alpha',
      strength: '10mg',
      dosage_form: 'vial',
      gtin: 'gtin-1',
    });
  });
  it('rejects invalid pagination, makes missing lists explicit, and never reports an outage as empty success', async () => {
    await request(app.getHttpServer())
      .get('/api/inventory?page=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/inventory?limit=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    failDatabase = true;
    try {
      for (const resource of Object.keys(
        READ_PERMISSIONS,
      ) as OperationalResource[])
        await expect(
          reads.list(resource, id(501), new OperationalQueryDto()),
        ).rejects.toMatchObject({ status: 503 });
    } finally {
      failDatabase = false;
    }
  });
});
