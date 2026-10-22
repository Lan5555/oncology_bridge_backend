import { transactionQueryBuilder } from '../../test/typeorm-query-builder';
import { MedicineService } from '../medicine/medicine.service';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { activeInventory } from '../inventory/active-inventory';
import { InventoryService } from '../inventory/inventory.service';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { Repository } from 'typeorm';
import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MarketplaceService, priceToKobo } from './marketplace.service';
import { CloudinaryImagesService } from './cloudinary-images.service';
import { PaystackService } from './paystack.service';
import { EncryptionService } from '../encryption/encryption.service';
import {
  CheckoutDto,
  CreateListingDto,
  ListingQueryDto,
} from './marketplace.dto';

jest.setTimeout(60000);
const seller = '00000000-0000-4000-8000-000000000001';
const buyer = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const facility = '00000000-0000-4000-8000-000000000004';
const buyerFacility = '00000000-0000-4000-8000-000000000005';
const medicine = '00000000-0000-4000-8000-000000000006';
const stock = '00000000-0000-4000-8000-000000000007';
const prescription = '00000000-0000-4000-8000-000000000008';
const input: CreateListingDto = {
  inventoryItemId: stock,
  category: 'Biologics',
  unitPriceNaira: '1250.25',
  availableQuantity: '10',
  unit: 'vial',
  storage: '2-8 C',
  description: 'One sealed vial',
  prescriptionRequired: 'false',
};

describe('marketplace PostgreSQL behavior', () => {
  let pg: PGlite;
  let service: MarketplaceService;
  let images: {
    upload: jest.Mock;
    cleanup: jest.Mock;
    cleanupPending: jest.Mock;
  };
  let paystack: {
    initialize: jest.Mock;
    verify: jest.Mock;
    assertConfigured: jest.Mock;
    authenticateWebhook: jest.Mock;
  };
  const query = async (sql: string, args: unknown[] = []) =>
    (await pg.query(sql, args)).rows as any[];

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE form_options(context text,value text,label text,active boolean DEFAULT true);
      INSERT INTO form_options(context,value) VALUES ('marketplace','Biologics'),('marketplace','Other'),('marketplace','Radiopharmaceuticals'),('marketplace','Different category');`);
    await pg.exec(`CREATE TABLE roles(id int PRIMARY KEY,name text);
      CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,status text,deleted_at timestamptz,state text);
      CREATE TABLE users(id uuid PRIMARY KEY,role_id int,hospital_id uuid,email text,active boolean,account_type text,verification_status text);
      CREATE TABLE verification_applications(id uuid PRIMARY KEY,user_id uuid,status text,submitted_at timestamptz DEFAULT now());
      CREATE TABLE role_permissions(role_id int,permission text);
      CREATE TABLE medicines(id uuid PRIMARY KEY,gtin text,generic_name text,brand_name text,strength text,storage_temperature text,deleted_at timestamptz);
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,batch_number text,expiry_date date,quantity int,status text,updated_at timestamptz,serial_number text,storage_unit_id uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE prescriptions(id uuid PRIMARY KEY,prescriber_id uuid,pharmacy_facility_id uuid,drug_id uuid,qty int,auth_status text,order_stage text);`);
    await pg.exec(
      readFileSync(resolve(process.cwd(), 'database/marketplace.sql'), 'utf8'),
    );
    await pg.exec(`CREATE TABLE storage_units(target_min numeric DEFAULT 2,target_max numeric DEFAULT 8);
      CREATE TABLE temperature_logs(recorded_at timestamptz DEFAULT now());`);
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/business-values.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/business-values.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/inventory-access.sql'),
        'utf8',
      ),
    );
    await pg.exec(
      'CREATE TABLE transfer_requests(id uuid PRIMARY KEY,medicine_id uuid,inventory_id uuid,status text,quantity int DEFAULT 0); CREATE TABLE audit_logs(action text,description text);',
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/medicine-deletion.sql'),
        'utf8',
      ),
    );
    const db = {
      manager: { query },
      query,
      transaction: async (isolationOrCallback: any, callback?: any) =>
        pg.transaction(async (tx) =>
          (callback ?? isolationOrCallback)({
            query: async (sql: string, args: unknown[] = []) =>
              (await tx.query(sql, args)).rows,
            createQueryBuilder: () =>
              transactionQueryBuilder(
                async (sql, parameters) =>
                  (await tx.query(sql, parameters)).rows,
              ),
          }),
        ),
    };
    images = {
      upload: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
      cleanupPending: jest.fn().mockResolvedValue(undefined),
    };
    paystack = {
      initialize: jest.fn(),
      verify: jest.fn(),
      assertConfigured: jest.fn(),
      authenticateWebhook: jest.fn(),
    };
    service = new MarketplaceService(
      db as unknown as DataSource,
      images as unknown as CloudinaryImagesService,
      paystack as unknown as PaystackService,
      { decrypt: () => 'buyer@example.test' } as unknown as EncryptionService,
      new ConfigService({ MARKETPLACE_RESERVATION_MINUTES: '15' }),
    );
  });
  afterAll(async () => {
    await pg?.close();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pg.exec(`TRUNCATE audit_logs,transfer_requests,marketplace_orders,marketplace_listing_images,marketplace_image_uploads,marketplace_listings,
      prescriptions,verification_applications,role_permissions,inventory,medicines,users,hospitals,roles CASCADE;`);
    await query("INSERT INTO roles VALUES (1,'PHARMACIST'),(2,'DOCTOR')");
    await query(
      "INSERT INTO hospitals(id,name,city,status,deleted_at) VALUES ($1,'Seller pharmacy','Lagos','ACTIVE',NULL),($2,'Buyer clinic','Abuja','ACTIVE',NULL)",
      [facility, buyerFacility],
    );
    await query(
      `INSERT INTO users VALUES ($1,1,$4,'encrypted',true,'PHARMACY_STORE','VERIFIED'),
      ($2,2,$5,'encrypted',true,'DOCTOR','VERIFIED'),($3,2,$5,'encrypted',true,'DOCTOR','VERIFIED')`,
      [seller, buyer, other, facility, buyerFacility],
    );
    for (const id of [seller, buyer, other])
      await query(
        "INSERT INTO verification_applications(id,user_id,status) VALUES ($1,$2,'VERIFIED')",
        [randomUUID(), id],
      );
    await query("INSERT INTO role_permissions VALUES (1,'marketplace.list')");
    await query(
      "INSERT INTO medicines(id,generic_name,brand_name,strength,storage_temperature,deleted_at,prescription_required) VALUES ($1,'Medicine alpha','Brand','10mg','2-8 C',NULL,false)",
      [medicine],
    );
    await query(
      "INSERT INTO inventory(id,hospital_id,medicine_id,batch_number,expiry_date,quantity,status,updated_at,selling_unit) VALUES ($1,$2,$3,'LOT-1',CURRENT_DATE+365,10,'AVAILABLE',now(),'vial')",
      [stock, facility, medicine],
    );
    images.upload.mockImplementation(async () => {
      const id = randomUUID();
      await query(
        'INSERT INTO marketplace_image_uploads(id,storage_key) VALUES ($1,$2)',
        [id, id],
      );
      return [
        {
          id,
          storageKey: id,
          url: 'https://res.cloudinary.com/test/image.webp',
          alt: 'Medicine packaging',
          position: 0,
          contentType: 'image/webp',
          byteSize: 50,
        },
      ];
    });
    paystack.initialize.mockImplementation(
      async (_email, _amount, reference) =>
        `https://checkout.paystack.com/${reference}`,
    );
    paystack.verify.mockImplementation(async (reference) => {
      const [row] = await query(
        'SELECT total_kobo FROM marketplace_orders WHERE payment_reference=$1',
        [reference],
      );
      return {
        status: 'success',
        reference,
        currency: 'NGN',
        amount: Number(row.total_kobo),
      };
    });
  });
  async function listing(overrides: Partial<CreateListingDto> = {}) {
    const result = await service.createListing(
      seller,
      { ...input, ...overrides },
      [{ buffer: Buffer.from('mock'), size: 4, mimetype: 'image/png' }],
    );
    return (result.data as any).listing.id as string;
  }
  async function checkout(
    listingId: string,
    quantity = 2,
    key = randomUUID(),
    extra: Partial<CheckoutDto> = {},
  ) {
    return service.checkout(buyer, key, { listingId, quantity, ...extra });
  }

  it('publishes photos, numeric NGN and a verified seller with filtered pagination', async () => {
    const id = await listing();
    const result = await service.browse(buyer, {
      q: 'alpha',
      location: 'Lagos',
      inStock: 'true',
      page: 1,
      limit: 1,
    });
    expect(result.data).toMatchObject({
      total: 1,
      items: [
        {
          id,
          unitPriceNaira: 1250.25,
          availableQuantity: 10,
          seller: { verified: true },
          images: [
            {
              url: 'https://res.cloudinary.com/test/image.webp',
              alt: 'Medicine packaging',
            },
          ],
        },
      ],
    });
    expect(
      (await service.browse(buyer, { q: 'absent', page: 1, limit: 1 })).data,
    ).toMatchObject({ total: 0, items: [] });
    expect(
      (await service.browse(buyer, { page: 2, limit: 1 })).data,
    ).toMatchObject({ total: 1, items: [] });
  });
  it('retains 10 boxes from intake through listing at a price per box and refresh', async () => {
    const batchId = randomUUID();
    const inventoryRepo: any = {
      findOne: async ({ where }: any) => {
        const [row] = await query('SELECT * FROM inventory WHERE id=$1', [
          where.id,
        ]);
        return row
          ? {
              ...row,
              hospital: { id: row.hospital_id },
              medicine: { id: row.medicine_id },
            }
          : null;
      },
      manager: {
        transaction: async (cb: any) =>
          pg.transaction(async (tx) => {
            const run = async (sql: string, args: any[] = []) =>
              (await tx.query(sql, args)).rows;
            const manager: any = {
              getRepository: (entity: any): any => {
                if (entity === Hospital)
                  return {
                    findOne: async () =>
                      (
                        await run(
                          'SELECT * FROM hospitals WHERE id=$1 FOR UPDATE',
                          [facility],
                        )
                      )[0],
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
                            await run(
                              'SELECT m.* FROM medicines m WHERE ' +
                                clauses
                                  .join(' AND ')
                                  .replaceAll(':medicineId', '$1')
                                  .replaceAll(':facilityId', '$2'),
                              [params.medicineId, params.facilityId],
                            )
                          )[0],
                      };
                      return qb;
                    },
                  };
                if (entity === AuditLog) return { save: async () => ({}) };
                if (entity === Inventory)
                  return {
                    create: (row: any) => row,
                    exists: async () => false,
                    save: async (row: any) => {
                      await run(
                        'INSERT INTO inventory(id,hospital_id,medicine_id,batch_number,expiry_date,quantity,selling_unit,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
                        [
                          batchId,
                          row.hospital.id,
                          row.medicine.id,
                          row.batch_number,
                          row.expiry_date,
                          row.quantity,
                          row.selling_unit,
                          row.status,
                        ],
                      );
                      return { ...row, id: batchId };
                    },
                  };
                throw new Error('Unexpected entity');
              },
            };
            return cb(manager);
          }),
      },
    };
    const intake = new InventoryService(
      inventoryRepo as Repository<Inventory>,
      {} as Repository<Hospital>,
      {} as Repository<Medicine>,
      {
        assertManage: async () => ({
          hospital: { id: facility, name: 'Seller pharmacy' },
        }),
      } as unknown as StockAccessService,
    );
    const added = await intake.create(
      {
        medicineId: medicine,
        batchNumber: 'BOX-001',
        expiry: '2027-12-31',
        quantity: 10,
        unit: 'box',
        facilityId: facility,
      },
      seller,
    );
    expect(added.data).toMatchObject({ unit: 'box', quantity: 10 });
    // A mismatched listing unit must fail before uploading images.
    await expect(
      listing({ inventoryItemId: batchId, unit: 'vial' }),
    ).rejects.toMatchObject({ status: 422 });
    const listingId = await listing({
      inventoryItemId: batchId,
      unit: 'box',
      unitPriceNaira: '2500.00',
      availableQuantity: '10',
    });
    const refreshed = await intake.findOne(batchId, facility);
    expect(refreshed.data).toMatchObject({ unit: 'box', quantity: 10 });
    const browsed = await service.browse(buyer, new ListingQueryDto());
    expect(
      browsed.data?.items.find((row) => row.id === listingId),
    ).toMatchObject({
      unit: 'box',
      unitPriceNaira: 2500,
      availableQuantity: 10,
      batchNumber: 'BOX-001',
    });
    expect(
      await query(
        'SELECT unit,quantity,price_kobo FROM marketplace_listings WHERE id=$1',
        [listingId],
      ),
    ).toEqual([{ unit: 'box', quantity: 10, price_kobo: 250000 }]);
  });
  it('soft-deletes catalogue medicines atomically, hides stock across refreshes and preserves payment/history traces', async () => {
    await query('UPDATE medicines SET catalog_facility_id=$1 WHERE id=$2', [
      facility,
      medicine,
    ]);
    const listingId = await listing();
    const paid = await checkout(listingId, 2);
    const paidReference = (paid.data as any).reference;
    // Settle one order before deletion; keep another reservation unpaid.
    await service.reconcile(paidReference);
    const pending = await checkout(listingId, 1, randomUUID());
    const pendingReference = (pending.data as any).reference;
    await query(
      "INSERT INTO transfer_requests(id,medicine_id,inventory_id,status) VALUES ($1,$2,$3,'PENDING_APPROVAL')",
      [randomUUID(), medicine, stock],
    );
    let failAudit = true;
    const db: any = {
      transaction: async (cb: any) =>
        pg.transaction(async (tx) => {
          const run = async (sql: string, args: any[] = []) =>
            (await tx.query(sql, args)).rows;
          return cb({
            query: run,
            createQueryBuilder: () => transactionQueryBuilder(run),
            getRepository: (entity: any): any => {
              if (entity === Medicine)
                return {
                  findOne: async ({ where }: any) =>
                    (
                      await run(
                        'SELECT * FROM medicines WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
                        [where.id],
                      )
                    )[0],
                  softDelete: async ({ id }: any) =>
                    run('UPDATE medicines SET deleted_at=now() WHERE id=$1', [
                      id,
                    ]),
                };
              if (entity === Inventory) return { exists: async () => false };
              if (entity === AuditLog)
                return {
                  save: async (row: any) => {
                    if (failAudit) throw new Error('Audit unavailable');
                    return run('INSERT INTO audit_logs VALUES ($1,$2)', [
                      row.action,
                      row.description,
                    ]);
                  },
                };
              throw new Error('Unexpected entity');
            },
          });
        }),
    };
    const catalogue = new MedicineService(
      {} as Repository<Medicine>,
      db as DataSource,
      {
        catalogueActor: async () => ({ facilityId: facility }),
      } as unknown as StockAccessService,
    );
    await expect(catalogue.remove(medicine, seller, 'test-ip')).rejects.toThrow(
      'Audit unavailable',
    );
    expect(
      (
        await query('SELECT deleted_at FROM medicines WHERE id=$1', [medicine])
      )[0].deleted_at,
    ).toBeNull();
    expect(
      (
        await query('SELECT status FROM marketplace_listings WHERE id=$1', [
          listingId,
        ])
      )[0].status,
    ).toBe('PUBLISHED');
    failAudit = false;
    const result = await catalogue.remove(medicine, seller, 'test-ip');
    expect(result.data).toMatchObject({
      medicine_active: false,
      affected: {
        batches: 1,
        listings: 1,
        reservations: 1,
        paidOrdersForReview: 1,
      },
    });
    expect(
      (
        await query('SELECT status,quantity FROM inventory WHERE id=$1', [
          stock,
        ])
      )[0],
    ).toEqual({ status: 'AVAILABLE', quantity: 8 });
    expect(
      (
        await query('SELECT status FROM marketplace_listings WHERE id=$1', [
          listingId,
        ])
      )[0].status,
    ).toBe('SUSPENDED');
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ total: 0, items: [] });
    // A fresh service/session reads persisted state, rather than cached flags.
    const readDb: any = {
      getRepository: (entity: any): any => {
        if (entity === User)
          return {
            findOne: async () => ({
              id: seller,
              active: true,
              role: { id: 1, name: 'PHARMACIST' },
              verification_status: 'VERIFIED',
              hospital: { id: facility, status: 'ACTIVE' },
            }),
          };
        if (entity === VerificationApplication)
          return { findOne: async () => ({ status: 'VERIFIED' }) };
        if (entity === RolePermission) return { findBy: async () => [] };
        throw new Error('Unexpected repository');
      },
      transaction: async (_level: any, cb: any) => cb({ query }),
    };
    const refreshed = new OperationalReadsService(readDb);
    const q = { page: 1, limit: 100, withinDays: 60 };
    expect((await refreshed.list('inventory', seller, q)).data).toMatchObject({
      total: 0,
      items: [],
    });
    const history = await refreshed.list('inventory', seller, {
      ...q,
      includeDeletedMedicines: true,
    });
    expect(history.data?.items[0]).toMatchObject({
      medicine: { id: medicine, active: false, deleted_at: expect.any(String) },
      medicine_deleted: true,
      medicine_active: false,
      qty: 8,
    });
    expect(
      (
        await query(
          'SELECT SUM(i.quantity)::int total FROM inventory i WHERE ' +
            activeInventory(),
        )
      )[0].total,
    ).toBeNull();
    expect(
      (
        await query(
          'SELECT reservation_state FROM marketplace_orders WHERE payment_reference=$1',
          [pendingReference],
        )
      )[0].reservation_state,
    ).toBe('RELEASED');
    expect(
      (
        await query(
          'SELECT payment_status,fulfillment_state FROM marketplace_orders WHERE payment_reference=$1',
          [paidReference],
        )
      )[0],
    ).toMatchObject({
      payment_status: 'PAID',
      fulfillment_state: 'PAYMENT_REVIEW_REQUIRED',
    });
    await expect(listing()).rejects.toMatchObject({ status: 409 });
    await expect(checkout(listingId, 1, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    await service.reconcile(pendingReference);
    expect(
      (
        await query(
          'SELECT payment_status FROM marketplace_orders WHERE payment_reference=$1',
          [pendingReference],
        )
      )[0].payment_status,
    ).toBe('PAID_REVIEW');
    expect(
      (await query('SELECT quantity FROM inventory WHERE id=$1', [stock]))[0]
        .quantity,
    ).toBe(8);
    expect(await query('SELECT * FROM marketplace_orders')).toHaveLength(2);
    expect(await query('SELECT * FROM transfer_requests')).toHaveLength(1);
    const audit = JSON.parse(
      (
        await query(
          "SELECT description FROM audit_logs WHERE action='MEDICINE_REMOVED'",
        )
      )[0].description,
    );
    expect(audit).toMatchObject({
      medicineId: medicine,
      physicalStockUnchanged: true,
      suspendedListingIds: [listingId],
      releasedReservationIds: expect.any(Array),
    });
    // Database guards also reject scanner/alternate writes and transfer approval.
    await expect(
      query('UPDATE inventory SET quantity=quantity+1 WHERE id=$1', [stock]),
    ).rejects.toMatchObject({ constraint: 'medicine_active_required' });
    await expect(
      query("UPDATE transfer_requests SET status='APPROVED'"),
    ).rejects.toMatchObject({ constraint: 'medicine_active_required' });
    await query("UPDATE transfer_requests SET status='REJECTED'");
    expect(
      (await query('SELECT medicine_id,status FROM transfer_requests'))[0],
    ).toEqual({ medicine_id: medicine, status: 'REJECTED' });
    await expect(
      query(
        'INSERT INTO inventory(id,hospital_id,medicine_id,quantity) VALUES ($1,$2,$3,1)',
        [randomUUID(), facility, medicine],
      ),
    ).rejects.toMatchObject({ constraint: 'medicine_active_required' });
  });
  it('rejects unauthorized seller, wrong facility, unreviewed units and unavailable batches before uploading', async () => {
    await expect(service.createListing(buyer, input, [])).rejects.toMatchObject(
      { status: 403 },
    );
    await query('UPDATE inventory SET hospital_id=$1 WHERE id=$2', [
      buyerFacility,
      stock,
    ]);
    await expect(listing()).rejects.toMatchObject({ status: 403 });
    await query(
      "UPDATE inventory SET hospital_id=$1,status='QUARANTINED' WHERE id=$2",
      [facility, stock],
    );
    await expect(listing()).rejects.toMatchObject({ status: 409 });
    await query(
      "UPDATE inventory SET status='AVAILABLE',selling_unit=NULL WHERE id=$1",
      [stock],
    );
    await expect(listing()).rejects.toMatchObject({ status: 422 });
    expect(images.upload).not.toHaveBeenCalled();
  });
  it('requires marketplace.list separately from stock access and immediately honors revocation', async () => {
    await query(
      "DELETE FROM role_permissions WHERE permission='marketplace.list'",
    );
    await query("INSERT INTO role_permissions VALUES (1,'inventory.manage')");
    await expect(listing()).rejects.toMatchObject({ status: 403 });
    await query("INSERT INTO role_permissions VALUES (1,'marketplace.list')");
    await listing();
    await query(
      "DELETE FROM role_permissions WHERE permission='marketplace.list'",
    );
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ total: 0 });
  });
  it('does not confer seller eligibility or foreign stock ownership on a network admin granted listing permission', async () => {
    await query("UPDATE roles SET name='ADMIN' WHERE id=2");
    await query(
      "INSERT INTO role_permissions VALUES (2,'admin.access'),(2,'marketplace.list')",
    );
    await expect(service.createListing(buyer, input, [])).rejects.toMatchObject(
      { status: 403 },
    );
    await query("UPDATE users SET account_type='PHARMACY_STORE' WHERE id=$1", [
      buyer,
    ]);
    await expect(service.createListing(buyer, input, [])).rejects.toMatchObject(
      { status: 403 },
    );
    expect(images.upload).not.toHaveBeenCalled();
  });
  it('requires the exact approved requirement and preserves its text through listing refresh', async () => {
    const approved =
      '  Refrigerate at 2?8?C.\nProtect from light; do not freeze.  ';
    await query('UPDATE medicines SET storage_temperature=$1 WHERE id=$2', [
      approved,
      medicine,
    ]);
    await expect(listing({ storage: approved.trim() })).rejects.toMatchObject({
      status: 422,
    });
    const listingId = await listing({ storage: approved });
    expect(
      (
        await query('SELECT storage FROM marketplace_listings WHERE id=$1', [
          listingId,
        ])
      )[0].storage,
    ).toBe(approved);
    const refreshed = await service.browse(buyer, new ListingQueryDto());
    expect(
      refreshed.data?.items.find((row) => row.id === listingId)?.storage,
    ).toBe(approved);
  });
  it.each([null, '', '   '])(
    'rejects a missing or blank approved requirement (%j) with an actionable error',
    async (requirement) => {
      await query('UPDATE medicines SET storage_temperature=$1 WHERE id=$2', [
        requirement,
        medicine,
      ]);
      await expect(listing()).rejects.toMatchObject({
        status: 422,
        response: {
          message: expect.stringContaining('authorized catalogue manager'),
        },
      });
      expect(images.upload).not.toHaveBeenCalled();
    },
  );
  it('rejects incorrect storage, expiry, excess quantity and duplicate batch listings', async () => {
    await expect(
      listing({ storage: 'room temperature' }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(listing({ availableQuantity: '11' })).rejects.toMatchObject({
      status: 409,
    });
    await query('UPDATE inventory SET expiry_date=CURRENT_DATE WHERE id=$1', [
      stock,
    ]);
    await expect(listing()).rejects.toMatchObject({ status: 409 });
    await query(
      'UPDATE inventory SET expiry_date=CURRENT_DATE+365 WHERE id=$1',
      [stock],
    );
    await listing();
    await expect(listing()).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back listings and cleans up uploaded objects after persistence failure', async () => {
    images.upload.mockResolvedValueOnce([
      {
        id: randomUUID(),
        storageKey: 'missing',
        url: 'https://cdn.test/image',
        alt: 'Photo',
        position: 0,
        contentType: 'image/webp',
        byteSize: 1,
      },
    ]);
    await expect(listing()).rejects.toThrow();
    expect(await query('SELECT id FROM marketplace_listings')).toHaveLength(0);
    expect(images.cleanup).toHaveBeenCalledWith(['missing']);
  });
  it('hides suspended sellers and rejects unverified buyers', async () => {
    await listing();
    await query("UPDATE hospitals SET status='SUSPENDED' WHERE id=$1", [
      facility,
    ]);
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ total: 0 });
    await query(
      "UPDATE verification_applications SET status='REJECTED' WHERE user_id=$1",
      [buyer],
    );
    await expect(
      service.browse(buyer, new ListingQueryDto()),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('replays concurrent checkout keys once and rejects payload conflicts without overselling', async () => {
    const id = await listing();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      checkout(id, 7, key),
      checkout(id, 7, key),
    ]);
    expect(a).toEqual(b);
    expect(paystack.initialize).toHaveBeenCalledTimes(1);
    expect(await query('SELECT id FROM marketplace_orders')).toHaveLength(1);
    await expect(checkout(id, 8, key)).rejects.toMatchObject({ status: 409 });
    await expect(checkout(id, 4)).rejects.toMatchObject({ status: 409 });
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ items: [{ availableQuantity: 3 }] });
    expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(
      10,
    );
  });
  it('uses the current server price and exact integer kobo', async () => {
    const id = await listing();
    await query(
      'UPDATE marketplace_listings SET price_kobo=12345 WHERE id=$1',
      [id],
    );
    const result = await checkout(id, 3);
    expect(result.data).toMatchObject({ totalNaira: 370.35 });
    expect(paystack.initialize).toHaveBeenCalledWith(
      'buyer@example.test',
      37035,
      expect.any(String),
      expect.stringMatching(/^OB-/),
    );
  });
  it('enforces prescription access, matching medicine, approval, and remaining quantities', async () => {
    await query('UPDATE medicines SET prescription_required=true WHERE id=$1', [
      medicine,
    ]);
    const id = await listing();
    await expect(checkout(id)).rejects.toMatchObject({ status: 422 });
    await query(
      "INSERT INTO prescriptions VALUES ($1,$2,$3,$4,3,'Pending','Waiting')",
      [prescription, buyer, buyerFacility, medicine],
    );
    await expect(
      checkout(id, 2, randomUUID(), { prescriptionId: prescription }),
    ).rejects.toMatchObject({ status: 422 });
    expect(paystack.initialize).not.toHaveBeenCalled();
    await query("UPDATE prescriptions SET auth_status='Approved' WHERE id=$1", [
      prescription,
    ]);
    await checkout(id, 2, randomUUID(), { prescriptionId: prescription });
    await expect(
      checkout(id, 2, randomUUID(), { prescriptionId: prescription }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('keeps one reservation and reference after an initialization timeout', async () => {
    const id = await listing();
    const key = randomUUID();
    paystack.initialize.mockRejectedValueOnce(new Error('timeout'));
    await expect(checkout(id, 2, key)).rejects.toThrow('timeout');
    const [order] = await query('SELECT * FROM marketplace_orders');
    expect(order.payment_status).toBe('INITIALIZATION_UNKNOWN');
    await checkout(id, 2, key);
    expect(await query('SELECT id FROM marketplace_orders')).toHaveLength(1);
    expect(paystack.initialize.mock.calls[0][2]).toBe(
      paystack.initialize.mock.calls[1][2],
    );
  });
  it('consumes stock once across webhook and invoice races and protects invoice access', async () => {
    const result = await checkout(await listing());
    const data = result.data as any;
    await expect(service.invoice(data.invoiceReference)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.invoice(data.invoiceReference, other),
    ).rejects.toMatchObject({ status: 403 });
    await Promise.all([
      service.reconcile(data.reference),
      service.reconcile(data.reference),
      service.invoice(data.invoiceReference, buyer),
    ]);
    expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(8);
    expect(await service.invoice(data.invoiceReference, buyer)).toMatchObject({
      status: 'PAID',
      isDemo: false,
      totalNaira: 2500.5,
      fulfillmentState: 'AWAITING_CLINICAL_RELEASE',
    });
  });
  it.each(['amount', 'currency', 'reference'])(
    'rejects mismatched payment %s without consuming stock',
    async (field) => {
      const result = await checkout(await listing());
      const data = result.data as any;
      paystack.verify.mockResolvedValue({
        status: 'success',
        amount: 250050,
        currency: 'NGN',
        reference: data.reference,
        [field]: field === 'amount' ? 1 : 'wrong',
      });
      await expect(service.reconcile(data.reference)).rejects.toMatchObject({
        status: 409,
      });
      expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(
        10,
      );
    },
  );
  it('prevents late payment from consuming expired stock', async () => {
    const id = await listing();
    const first = (await checkout(id, 10)).data as any;
    await query(
      "UPDATE marketplace_orders SET expires_at=now()-interval '1 minute'",
    );
    await checkout(id, 10);
    await service.reconcile(first.reference);
    expect(
      (
        await query(
          'SELECT payment_status FROM marketplace_orders WHERE payment_reference=$1',
          [first.reference],
        )
      )[0].payment_status,
    ).toBe('PAID_REVIEW');
    expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(
      10,
    );
  });
  it('does not consume quarantined stock after payment', async () => {
    const data = (await checkout(await listing())).data as any;
    await query("UPDATE inventory SET status='QUARANTINED' WHERE id=$1", [
      stock,
    ]);
    await service.reconcile(data.reference);
    expect(
      (await query('SELECT payment_status FROM marketplace_orders'))[0]
        .payment_status,
    ).toBe('PAID_REVIEW');
    expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(
      10,
    );
  });
  it('protects reservations and batch identity from legacy inventory mutations', async () => {
    await checkout(await listing(), 7);
    await expect(
      query('UPDATE inventory SET quantity=6 WHERE id=$1', [stock]),
    ).rejects.toThrow('reserved');
    await expect(
      query("UPDATE inventory SET selling_unit='pack' WHERE id=$1", [stock]),
    ).rejects.toThrow('identity');
    await query('UPDATE inventory SET quantity=8 WHERE id=$1', [stock]);
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ items: [{ availableQuantity: 1 }] });
  });

  it('allows only one of two different checkout keys to reserve the last stock', async () => {
    const id = await listing();
    const results = await Promise.allSettled([
      checkout(id, 7),
      checkout(id, 7),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await query('SELECT id FROM marketplace_orders')).toHaveLength(1);
  });

  it('releases verified failed payments and exposes the stored failure in invoice reads', async () => {
    const data = (await checkout(await listing(), 10)).data as any;
    paystack.verify.mockResolvedValue({
      status: 'failed',
      amount: 1250250,
      currency: 'NGN',
      reference: data.reference,
    });
    await service.reconcile(data.reference);
    expect(
      (await query('SELECT reservation_state FROM marketplace_orders'))[0]
        .reservation_state,
    ).toBe('RELEASED');
    expect(
      (await service.browse(buyer, new ListingQueryDto())).data,
    ).toMatchObject({ items: [{ availableQuantity: 10 }] });
    expect(await service.invoice(data.invoiceReference, buyer)).toMatchObject({
      status: 'PAYMENT_FAILED',
      paystackUrl: null,
    });
  });

  it('replays webhook deliveries idempotently', async () => {
    const data = (await checkout(await listing())).data as any;
    const event = {
      event: 'charge.success',
      data: { reference: data.reference },
    };
    await service.webhook(Buffer.from('{}'), 'mock-signature', event);
    await service.webhook(Buffer.from('{}'), 'mock-signature', event);
    expect((await query('SELECT quantity FROM inventory'))[0].quantity).toBe(8);
  });

  it('filters and sorts before pagination across multiple batches', async () => {
    const first = await listing();
    const secondStock = randomUUID();
    const thirdStock = randomUUID();
    await query(
      `INSERT INTO inventory(id,hospital_id,medicine_id,batch_number,expiry_date,quantity,status,selling_unit)
      VALUES ($1,$3,$4,'LOT-2',CURRENT_DATE+400,10,'AVAILABLE','vial'),($2,$3,$4,'LOT-3',CURRENT_DATE+300,10,'AVAILABLE','vial')`,
      [secondStock, thirdStock, facility, medicine],
    );
    const second = await listing({
      inventoryItemId: secondStock,
      unitPriceNaira: '500.00',
    });
    await listing({
      inventoryItemId: thirdStock,
      category: 'Other',
      unitPriceNaira: '1',
    });
    expect(
      (
        await service.browse(buyer, {
          page: 1,
          limit: 1,
          category: 'Biologics',
          sort: 'price_asc',
        })
      ).data,
    ).toMatchObject({ total: 2, items: [{ id: second }] });
    expect(
      (
        await service.browse(buyer, {
          page: 2,
          limit: 1,
          category: 'Biologics',
          sort: 'price_asc',
        })
      ).data,
    ).toMatchObject({ total: 2, items: [{ id: first }] });
  });
  it('persists and searches an explicit category outside the former database enum', async () => {
    const listingId = await listing({ category: '  Radiopharmaceuticals  ' });
    expect(
      (
        await query('SELECT category FROM marketplace_listings WHERE id=$1', [
          listingId,
        ])
      )[0].category,
    ).toBe('Radiopharmaceuticals');
    expect(
      (
        await service.browse(buyer, {
          page: 1,
          limit: 12,
          category: 'Radiopharmaceuticals',
        })
      ).data,
    ).toMatchObject({ total: 1, items: [{ id: listingId }] });
    expect(
      (
        await service.browse(buyer, {
          page: 1,
          limit: 12,
          category: 'Different category',
        })
      ).data,
    ).toMatchObject({ total: 0, items: [] });
    await expect(listing({ category: ' ' })).rejects.toThrow('category');
  });
  it('rejects withdrawn managed categories before upload and on search', async () => {
    await query("UPDATE form_options SET active=false WHERE value='Biologics'");
    await expect(listing()).rejects.toMatchObject({ status: 422 });
    expect(images.upload).not.toHaveBeenCalled();
    await expect(
      service.browse(buyer, { page: 1, limit: 12, category: 'Biologics' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('price conversion', () => {
  it.each([
    ['0.01', 1],
    ['1250.25', 125025],
    ['10.1', 1010],
  ])('converts %s to integer kobo', (input, expected) => {
    expect(priceToKobo(input)).toBe(expected);
  });
  it.each(['0', '-1', '1.001', 'NaN', '1e4', '01.00'])('rejects %s', (input) =>
    expect(() => priceToKobo(input)).toThrow(),
  );
});
