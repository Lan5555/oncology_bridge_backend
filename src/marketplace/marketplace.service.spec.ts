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
    await pg.exec(`CREATE TABLE roles(id int PRIMARY KEY,name text);
      CREATE TABLE hospitals(id uuid PRIMARY KEY,name text,city text,status text,deleted_at timestamptz);
      CREATE TABLE users(id uuid PRIMARY KEY,role_id int,hospital_id uuid,email text,active boolean,account_type text,verification_status text);
      CREATE TABLE verification_applications(id uuid PRIMARY KEY,user_id uuid,status text,submitted_at timestamptz DEFAULT now());
      CREATE TABLE role_permissions(role_id int,permission text);
      CREATE TABLE medicines(id uuid PRIMARY KEY,generic_name text,brand_name text,strength text,storage_temperature text,deleted_at timestamptz);
      CREATE TABLE inventory(id uuid PRIMARY KEY,hospital_id uuid,medicine_id uuid,batch_number text,expiry_date date,quantity int,status text,updated_at timestamptz);
      CREATE TABLE prescriptions(id uuid PRIMARY KEY,prescriber_id uuid,pharmacy_facility_id uuid,drug_id uuid,qty int,auth_status text,order_stage text);`);
    await pg.exec(
      readFileSync(resolve(process.cwd(), 'database/marketplace.sql'), 'utf8'),
    );
    await pg.exec(
      readFileSync(
        resolve(process.cwd(), 'database/inventory-access.sql'),
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
    await pg.exec(`TRUNCATE marketplace_orders,marketplace_listing_images,marketplace_image_uploads,marketplace_listings,
      prescriptions,verification_applications,role_permissions,inventory,medicines,users,hospitals,roles CASCADE;`);
    await query("INSERT INTO roles VALUES (1,'PHARMACIST'),(2,'DOCTOR')");
    await query(
      "INSERT INTO hospitals VALUES ($1,'Seller pharmacy','Lagos','ACTIVE',NULL),($2,'Buyer clinic','Abuja','ACTIVE',NULL)",
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
      "INSERT INTO inventory VALUES ($1,$2,$3,'LOT-1',CURRENT_DATE+365,10,'AVAILABLE',now(),'vial')",
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
