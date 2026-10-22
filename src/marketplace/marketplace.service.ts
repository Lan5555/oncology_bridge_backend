import { SELLING_UNITS } from '../inventory/selling-unit';
import { listingExists } from './listing-exists';
import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ActorRow,
  BatchRow,
  ListingRow,
  OrderRow,
  PrescriptionRow,
} from './marketplace.rows';
import { EncryptionService } from '../encryption/encryption.service';
import { ResponseHelper } from '../helpers/response-helper';
import {
  CheckoutDto,
  CreateListingDto,
  ListingQueryDto,
} from './marketplace.dto';
import {
  CloudinaryImagesService,
  ListingImage,
  ListingUpload,
} from './cloudinary-images.service';
import { PaystackService, VerifiedPayment } from './paystack.service';
import { MARKETPLACE_LIST_PERMISSION } from '../role/permission-keys';
import { businessLabel } from '../helpers/business-values';
import { managedValue } from '../form_options/form-options.service';

const VERIFIED = `(SELECT v.status FROM verification_applications v WHERE v.user_id=u.id ORDER BY v.submitted_at DESC,v.id DESC LIMIT 1)='VERIFIED'`;
const SELLER = `h.status='ACTIVE' AND h.deleted_at IS NULL AND u.active=true AND u.verification_status='VERIFIED'
 AND u.hospital_id=h.id AND u.account_type='PHARMACY_STORE' AND ${VERIFIED}
 AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=u.role_id AND rp.permission='${MARKETPLACE_LIST_PERMISSION}')`;
const FROM_LISTING = `FROM marketplace_listings l JOIN inventory i ON i.id=l.inventory_item_id
 JOIN medicines m ON m.id=i.medicine_id JOIN hospitals h ON h.id=l.facility_id JOIN users u ON u.id=l.creator_id`;
const ELIGIBLE = `${SELLER} AND l.status='PUBLISHED' AND i.hospital_id=h.id AND i.status='AVAILABLE'
 AND i.expiry_date > CURRENT_DATE AND m.deleted_at IS NULL AND i.selling_unit=l.unit`;
const BALANCE = `LEFT JOIN LATERAL (SELECT
 COALESCE(sum(o.quantity) FILTER (WHERE o.reservation_state='RESERVED' AND o.expires_at>now()),0)::int reserved,
 COALESCE(sum(o.quantity) FILTER (WHERE o.reservation_state='CONSUMED'),0)::int consumed
 FROM marketplace_orders o WHERE o.inventory_item_id=i.id) b ON true`;
const AVAILABLE =
  'GREATEST(0,LEAST(i.quantity-b.reserved,l.quantity-b.consumed-b.reserved))';

export function priceToKobo(value: string): number {
  if (!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(value))
    throw new HttpException(
      {
        message: 'Enter a positive price with at most two decimal places.',
        code: 'INVALID_LISTING',
      },
      422,
    );
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 9000000000000)
    throw new HttpException(
      {
        message: 'Price is outside the supported range.',
        code: 'INVALID_LISTING',
      },
      422,
    );
  return amount;
}

@Injectable()
export class MarketplaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceService.name);
  private timer?: NodeJS.Timeout;
  private working = false;
  constructor(
    private readonly db: DataSource,
    private readonly images: CloudinaryImagesService,
    private readonly paystack: PaystackService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Database-backed work is safe across multiple replicas; external operations use stable IDs.
    this.timer = setInterval(() => {
      void this.maintenance();
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private fail(status: number, code: string, message: string): never {
    throw new HttpException({ message, code }, status);
  }
  private async lock(manager: EntityManager) {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtext('oncology-marketplace-stock'))",
    );
  }
  private async actor(manager: EntityManager, id: string, listing = false) {
    const [user] = await manager.query<ActorRow[]>(
      `SELECT u.*,r.name role_name,h.status facility_status,h.deleted_at facility_deleted,
      ${VERIFIED} verified_record,
      EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=u.role_id AND rp.permission='${MARKETPLACE_LIST_PERMISSION}') can_list
      FROM users u JOIN roles r ON r.id=u.role_id JOIN hospitals h ON h.id=u.hospital_id WHERE u.id=$1`,
      [id],
    );
    if (
      !user?.active ||
      user.verification_status !== 'VERIFIED' ||
      !user.verified_record
    )
      this.fail(
        403,
        'NOT_VERIFIED',
        'An active account with approved licence verification is required.',
      );
    if (user.facility_status !== 'ACTIVE' || user.facility_deleted)
      this.fail(403, 'FACILITY_FORBIDDEN', 'An active facility is required.');
    const account = (user.account_type || user.role_name).trim().toUpperCase();
    if (
      !['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE'].includes(account) ||
      (listing && (account !== 'PHARMACY_STORE' || !user.can_list))
    )
      this.fail(
        403,
        'FACILITY_FORBIDDEN',
        listing
          ? 'Your account does not have permission to list facility stock.'
          : 'Your account cannot use the medicine marketplace.',
      );
    return user;
  }

  async browse(actorId: string, query: ListingQueryDto) {
    await this.actor(this.db.manager, actorId);
    if (query.category?.trim())
      await managedValue(this.db.manager, 'marketplace', query.category);
    const values: unknown[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const where = [ELIGIBLE];
    if (query.q) {
      const p = add(`%${query.q}%`);
      where.push(`(m.generic_name ILIKE ${p} OR m.brand_name ILIKE ${p})`);
    }
    if (query.location) {
      const p = add(`%${query.location}%`);
      where.push(`(h.city ILIKE ${p} OR h.name ILIKE ${p})`);
    }
    if (query.category?.trim())
      where.push(
        `LOWER(l.category)=LOWER(${add(businessLabel(query.category, 'category', 100))})`,
      );
    if (query.inStock === 'true') where.push(`${AVAILABLE}>0`);
    const base = `${FROM_LISTING} ${BALANCE} WHERE ${where.join(' AND ')}`;
    const sorts = {
      newest: 'l.created_at DESC',
      price_asc: 'l.price_kobo ASC',
      price_desc: 'l.price_kobo DESC',
      expiry_asc: 'i.expiry_date ASC',
    };
    // A repeatable read keeps total and page consistent while checkout traffic changes stock.
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int total ${base}`,
        values,
      );
      const rows = await manager.query<ListingRow[]>(
        `SELECT l.*,m.generic_name,m.brand_name,m.strength,m.prescription_required clinical_rx,
        i.batch_number,to_char(i.expiry_date,'YYYY-MM-DD') expires_on,h.name seller_name,h.city,
        ${AVAILABLE} available,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'url',p.url,'alt',p.alt) ORDER BY p.position)
          FROM marketplace_listing_images p WHERE p.listing_id=l.id),'[]'::jsonb) images
        ${base} ORDER BY ${sorts[query.sort ?? 'newest']},l.id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [
          ...values,
          query.limit ?? 12,
          ((query.page ?? 1) - 1) * (query.limit ?? 12),
        ],
      );
      return ResponseHelper.Success('', {
        items: rows.map((r: ListingRow) => ({
          id: r.id,
          inventoryItemId: r.inventory_item_id,
          name: r.generic_name,
          brand: r.brand_name ?? '',
          strength: r.strength ?? '',
          category: r.category,
          description: r.description ?? '',
          unit: r.unit,
          unitPriceNaira: Number(r.price_kobo) / 100,
          availableQuantity: Number(r.available),
          batchNumber: r.batch_number,
          expiresOn: r.expires_on,
          storage: r.storage ?? '',
          prescriptionRequired: r.prescription_required || r.clinical_rx,
          images: r.images,
          seller: {
            id: r.facility_id,
            name: r.seller_name,
            city: r.city,
            verified: true,
          },
        })),
        total: count.total,
        page: query.page ?? 1,
        limit: query.limit ?? 12,
      });
    });
  }

  private async validateBatch(
    manager: EntityManager,
    actorId: string,
    dto: CreateListingDto,
  ) {
    const user = await this.actor(manager, actorId, true);
    const [batch] = await manager.query<BatchRow[]>(
      `SELECT i.*,m.storage_temperature,m.prescription_required,m.deleted_at,
      i.expiry_date>CURRENT_DATE valid_expiry FROM inventory i JOIN medicines m ON m.id=i.medicine_id
      WHERE i.id=$1 FOR UPDATE OF i`,
      [dto.inventoryItemId],
    );
    if (!batch || batch.hospital_id !== user.hospital_id)
      this.fail(
        403,
        'FACILITY_FORBIDDEN',
        'The inventory batch must belong to your active facility.',
      );
    if (batch.status !== 'AVAILABLE' || !batch.valid_expiry || batch.deleted_at)
      this.fail(
        409,
        'STOCK_UNAVAILABLE',
        'This batch is not eligible for sale.',
      );
    if (
      !batch.selling_unit ||
      !SELLING_UNITS.includes(
        batch.selling_unit as (typeof SELLING_UNITS)[number],
      ) ||
      batch.selling_unit !== dto.unit
    )
      this.fail(
        422,
        'INVALID_LISTING',
        'The unit must match the reviewed inventory selling unit.',
      );
    if (!batch.storage_temperature?.trim())
      this.fail(
        422,
        'INVALID_LISTING',
        'The linked medicine has no approved storage requirement. Ask an authorized catalogue manager to record it before listing this batch.',
      );
    if (!dto.storage?.trim() || dto.storage !== batch.storage_temperature)
      this.fail(
        422,
        'INVALID_LISTING',
        'Storage must exactly match the approved medicine storage requirement. Refresh inventory and submit the linked medicine requirement unchanged.',
      );
    if (!dto.description.trim())
      this.fail(
        422,
        'INVALID_LISTING',
        'A product and pack description is required.',
      );
    const [reserved] = await manager.query<{ qty: number }[]>(
      `SELECT COALESCE(sum(quantity),0)::int qty FROM marketplace_orders
      WHERE inventory_item_id=$1 AND reservation_state='RESERVED' AND expires_at>now()`,
      [batch.id],
    );
    if (Number(dto.availableQuantity) > batch.quantity - reserved.qty)
      this.fail(
        409,
        'STOCK_UNAVAILABLE',
        'Listing quantity exceeds unreserved stock.',
      );
    if (await listingExists(manager, batch.id))
      this.fail(
        409,
        'INVALID_LISTING',
        'This inventory batch already has a listing.',
      );
    return batch;
  }

  async createListing(
    actorId: string,
    dto: CreateListingDto,
    files: ListingUpload[],
  ) {
    const category = businessLabel(dto.category, 'category', 100);
    const price = priceToKobo(dto.unitPriceNaira);
    await this.db.transaction(async (m) => {
      await this.lock(m);
      await managedValue(m, 'marketplace', category);
      await this.validateBatch(m, actorId, dto);
    });
    const photos = await this.images.upload(files);
    try {
      return await this.db.transaction(async (manager) => {
        await this.lock(manager);
        const batch = await this.validateBatch(manager, actorId, dto);
        await managedValue(manager, 'marketplace', category);
        const id = randomUUID();
        await manager.query(
          `INSERT INTO marketplace_listings(id,inventory_item_id,facility_id,creator_id,category,
          unit,price_kobo,quantity,description,storage,prescription_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            batch.id,
            batch.hospital_id,
            actorId,
            category,
            dto.unit,
            price,
            Number(dto.availableQuantity),
            dto.description.trim(),
            batch.storage_temperature,
            batch.prescription_required || dto.prescriptionRequired === 'true',
          ],
        );
        for (const photo of photos) await this.attachImage(manager, id, photo);
        return ResponseHelper.Success('Listing submitted.', {
          listing: {
            id,
            status: 'PUBLISHED',
            unit: batch.selling_unit,
            availableQuantity: Number(dto.availableQuantity),
            unitPriceNaira: price / 100,
          },
        });
      });
    } catch (error) {
      await this.images.cleanup(photos.map((p) => p.storageKey));
      throw error;
    }
  }
  private async attachImage(
    manager: EntityManager,
    id: string,
    photo: ListingImage,
  ) {
    await manager.query(
      `INSERT INTO marketplace_listing_images(id,listing_id,storage_key,url,alt,position,content_type,byte_size)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        photo.id,
        id,
        photo.storageKey,
        photo.url,
        photo.alt,
        photo.position,
        photo.contentType,
        photo.byteSize,
      ],
    );
    await manager.query(
      "UPDATE marketplace_image_uploads SET state='ATTACHED' WHERE id=$1",
      [photo.id],
    );
  }

  private async prescription(
    manager: EntityManager,
    id: string | undefined,
    user: ActorRow,
    medicineId: string,
    quantity: number,
    excludeOrder?: string,
  ) {
    if (!id)
      this.fail(
        422,
        'PRESCRIPTION_REQUIRED',
        'An approved prescription reference is required.',
      );
    const [rx] = await manager.query<PrescriptionRow[]>(
      'SELECT * FROM prescriptions WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (
      !rx ||
      (rx.prescriber_id !== user.id &&
        rx.pharmacy_facility_id !== user.hospital_id) ||
      rx.drug_id !== medicineId ||
      rx.auth_status?.toUpperCase() !== 'APPROVED' ||
      ['DELIVERED', 'DISPENSED', 'CANCELLED', 'REJECTED'].includes(
        rx.order_stage?.toUpperCase(),
      )
    )
      this.fail(
        422,
        'PRESCRIPTION_NOT_APPROVED',
        'The prescription must be approved, accessible, unfulfilled and match this medicine.',
      );
    const [used] = await manager.query<{ qty: number }[]>(
      `SELECT COALESCE(sum(quantity),0)::int qty FROM marketplace_orders WHERE prescription_id=$1
      AND ($2::uuid IS NULL OR id<>$2) AND (reservation_state='CONSUMED' OR payment_status='PAID_REVIEW' OR
      (reservation_state='RESERVED' AND expires_at>now()))`,
      [id, excludeOrder ?? null],
    );
    if (used.qty + quantity > rx.qty)
      this.fail(
        422,
        'PRESCRIPTION_NOT_APPROVED',
        'The requested quantity exceeds the prescription remaining quantity.',
      );
  }

  async checkout(actorId: string, key: string | undefined, dto: CheckoutDto) {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      this.fail(
        422,
        'IDEMPOTENCY_CONFLICT',
        'Provide a UUID Idempotency-Key header.',
      );
    this.paystack.assertConfigured();
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          dto.listingId.toLowerCase(),
          dto.quantity,
          dto.prescriptionId?.toLowerCase() ?? null,
        ]),
      )
      .digest('hex');
    const order = await this.db.transaction(async (manager) => {
      await this.lock(manager);
      const user = await this.actor(manager, actorId);
      const [existing] = await manager.query<OrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE buyer_id=$1 AND idempotency_key=$2',
        [actorId, key],
      );
      if (existing) {
        if (existing.payload_hash !== hash)
          this.fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This checkout key was used for different details.',
          );
        return existing;
      }
      const [row] = await manager.query<ListingRow[]>(
        `SELECT l.*,i.medicine_id,i.quantity stock_quantity,m.generic_name,m.brand_name,m.strength,
        m.prescription_required clinical_rx,i.batch_number,to_char(i.expiry_date,'YYYY-MM-DD') expires_on,h.name seller_name,h.city,
        ${AVAILABLE} available ${FROM_LISTING} ${BALANCE} WHERE l.id=$1 AND ${ELIGIBLE} FOR UPDATE OF i,l`,
        [dto.listingId],
      );
      if (!row || row.available < dto.quantity)
        this.fail(
          409,
          'STOCK_UNAVAILABLE',
          'The requested stock is no longer available.',
        );
      if (row.prescription_required || row.clinical_rx || dto.prescriptionId)
        await this.prescription(
          manager,
          dto.prescriptionId,
          user,
          row.medicine_id,
          dto.quantity,
        );
      const total = Number(row.price_kobo) * dto.quantity;
      if (!Number.isSafeInteger(total) || total > 9000000000000)
        this.fail(
          422,
          'INVALID_QUANTITY',
          'The order total exceeds the supported range.',
        );
      const id = randomUUID();
      const invoice = `OB-${randomUUID().replaceAll('-', '').slice(0, 28)}`;
      const payment = `OB-MP-${id}`;
      const snapshot = {
        medicineId: row.medicine_id,
        name: row.generic_name,
        brand: row.brand_name ?? '',
        strength: row.strength ?? '',
        batchNumber: row.batch_number,
        expiresOn: row.expires_on,
        unit: row.unit,
        storage: row.storage,
        prescriptionRequired: row.prescription_required || row.clinical_rx,
        seller: { id: row.facility_id, name: row.seller_name, city: row.city },
        quantity: dto.quantity,
        unitPriceKobo: Number(row.price_kobo),
        feesKobo: 0,
      };
      const minutes = Math.min(
        60,
        Math.max(
          5,
          Number(this.config.get('MARKETPLACE_RESERVATION_MINUTES')) || 15,
        ),
      );
      const [created] = await manager.query<OrderRow[]>(
        `INSERT INTO marketplace_orders(id,buyer_id,listing_id,inventory_item_id,facility_id,
        prescription_id,idempotency_key,payload_hash,quantity,unit_price_kobo,total_kobo,snapshot,invoice_reference,payment_reference,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()+($15 * interval '1 minute')) RETURNING *`,
        [
          id,
          actorId,
          row.id,
          row.inventory_item_id,
          row.facility_id,
          dto.prescriptionId ?? null,
          key,
          hash,
          dto.quantity,
          row.price_kobo,
          total,
          snapshot,
          invoice,
          payment,
          minutes,
        ],
      );
      return created;
    });
    const ready = await this.initialize(order.id, actorId);
    return ResponseHelper.Success(
      'Checkout ready.',
      this.checkoutResult(ready),
    );
  }

  private checkoutResult(order: OrderRow) {
    return {
      authorizationUrl: order.authorization_url,
      reference: order.payment_reference,
      invoiceReference: order.invoice_reference,
      orderId: order.id,
      totalNaira: Number(order.total_kobo) / 100,
      expiresAt: new Date(order.expires_at).toISOString(),
    };
  }
  private async initialize(id: string, actorId: string) {
    return this.db
      .transaction(async (manager) => {
        const [order] = await manager.query<OrderRow[]>(
          'SELECT * FROM marketplace_orders WHERE id=$1 FOR UPDATE',
          [id],
        );
        const user = await this.actor(manager, actorId);
        if (
          ['PAID', 'PAID_REVIEW'].includes(order.payment_status) &&
          order.authorization_url
        )
          return order;
        if (
          new Date(order.expires_at).getTime() <= Date.now() ||
          order.reservation_state !== 'RESERVED'
        )
          this.fail(
            409,
            'STOCK_UNAVAILABLE',
            'This checkout reservation has expired. Start a new checkout.',
          );
        const [eligible] = await manager.query<{ id: string }[]>(
          `SELECT l.id ${FROM_LISTING} WHERE l.id=$1 AND ${ELIGIBLE}`,
          [order.listing_id],
        );
        if (!eligible)
          this.fail(
            409,
            'STOCK_UNAVAILABLE',
            'The seller or stock is no longer eligible for checkout.',
          );
        if (order.authorization_url) return order;
        // Always reuse the persisted provider reference, including ambiguous initialization timeouts.
        try {
          const email = this.encryption.decrypt(user.email);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new ServiceUnavailableException(
              'The buyer email is unavailable.',
            );
          const url = await this.paystack.initialize(
            email,
            Number(order.total_kobo),
            order.payment_reference,
            order.invoice_reference,
          );
          const [saved] = await manager.query<OrderRow[]>(
            `UPDATE marketplace_orders SET authorization_url=$2,initialization_attempted=true,
          payment_status='AWAITING_PAYMENT' WHERE id=$1 RETURNING *`,
            [id, url],
          );
          return saved;
        } catch (error) {
          // Commit the uncertain state. Reconciliation must verify rather than release immediately.
          await manager.query(
            "UPDATE marketplace_orders SET initialization_attempted=true,payment_status='INITIALIZATION_UNKNOWN' WHERE id=$1",
            [id],
          );
          return { ...order, initializationError: error };
        }
      })
      .then((order) => {
        if (order.initializationError) throw order.initializationError;
        return order;
      });
  }

  async webhook(
    raw: Buffer | undefined,
    signature: string | undefined,
    event: unknown,
  ) {
    this.paystack.authenticateWebhook(raw, signature);
    const parsed = event as {
      event?: unknown;
      data?: { reference?: unknown };
    } | null;
    if (
      parsed?.event === 'charge.success' &&
      typeof parsed?.data?.reference === 'string'
    ) {
      const [order] = await this.db.query<OrderRow[]>(
        'SELECT id FROM marketplace_orders WHERE payment_reference=$1',
        [parsed.data.reference],
      );
      if (order) await this.reconcile(parsed.data.reference);
    }
    return { success: true };
  }

  async reconcile(reference: string) {
    const payment = await this.paystack.verify(reference);
    return this.applyPayment(reference, payment);
  }
  private async applyPayment(reference: string, payment: VerifiedPayment) {
    return this.db.transaction(async (manager) => {
      await this.lock(manager);
      const [order] = await manager.query<OrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE payment_reference=$1 FOR UPDATE',
        [reference],
      );
      if (!order || ['PAID', 'PAID_REVIEW'].includes(order.payment_status))
        return;
      if (
        payment.reference !== reference ||
        payment.currency !== 'NGN' ||
        !Number.isSafeInteger(payment.amount) ||
        payment.amount !== Number(order.total_kobo)
      )
        this.fail(
          409,
          'PAYMENT_MISMATCH',
          'Payment reference, currency or amount did not match the stored order.',
        );
      if (payment.status !== 'success') {
        const failed = ['failed', 'abandoned', 'reversed'].includes(
          payment.status,
        );
        await manager.query(
          `UPDATE marketplace_orders SET last_verified_at=now(),payment_status=$2,
          reservation_state=CASE WHEN $3 OR expires_at<=now() THEN 'RELEASED' ELSE reservation_state END WHERE id=$1`,
          [
            order.id,
            failed
              ? 'PAYMENT_FAILED'
              : new Date(order.expires_at).getTime() <= Date.now()
                ? 'EXPIRED'
                : 'AWAITING_PAYMENT',
            failed,
          ],
        );
        return;
      }
      let release =
        order.reservation_state !== 'RESERVED' ||
        new Date(order.expires_at).getTime() <= Date.now();
      const [stock] = await manager.query<BatchRow[]>(
        `SELECT i.id,i.quantity,i.medicine_id,m.prescription_required clinical_rx
        ${FROM_LISTING} WHERE l.id=$1 AND ${ELIGIBLE} FOR UPDATE OF i,l`,
        [order.listing_id],
      );
      if (!stock || stock.quantity < order.quantity) release = true;
      // Any policy change after checkout requires review, including a new prescription requirement.
      try {
        const buyer = await this.actor(manager, order.buyer_id);
        if (
          stock &&
          (stock.clinical_rx ||
            order.snapshot.prescriptionRequired ||
            order.prescription_id)
        )
          await this.prescription(
            manager,
            order.prescription_id ?? undefined,
            buyer,
            stock.medicine_id,
            order.quantity,
            order.id,
          );
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        release = true;
      }
      // Release our hold before decrementing so the stock trigger protects only other buyers.
      await manager.query(
        `UPDATE marketplace_orders SET payment_status=$2,reservation_state=$3,paid_at=now(),last_verified_at=now(),
        fulfillment_state=$4 WHERE id=$1`,
        [
          order.id,
          release ? 'PAID_REVIEW' : 'PAID',
          release ? 'RELEASED' : 'CONSUMED',
          release ? 'PAYMENT_REVIEW_REQUIRED' : 'AWAITING_CLINICAL_RELEASE',
        ],
      );
      if (!release)
        await manager.query(
          'UPDATE inventory SET quantity=quantity-$2,updated_at=now() WHERE id=$1',
          [order.inventory_item_id, order.quantity],
        );
      return { status: release ? 'PAID_REVIEW' : 'PAID' };
    });
  }

  async invoice(reference: string, actorId?: string) {
    let [order] = await this.db.query<OrderRow[]>(
      'SELECT * FROM marketplace_orders WHERE invoice_reference=$1',
      [reference],
    );
    if (!order) return null;
    if (!actorId || order.buyer_id !== actorId)
      throw new ForbiddenException(
        'Only the buyer can access this marketplace invoice.',
      );
    await this.actor(this.db.manager, actorId);
    if (!['PAID', 'PAID_REVIEW'].includes(order.payment_status)) {
      try {
        await this.reconcile(order.payment_reference);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        // Keep persisted state during provider outages; never infer payment from callback parameters.
      }
      [order] = await this.db.query<OrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE id=$1',
        [order.id],
      );
    }
    const expired =
      order.reservation_state === 'RESERVED' &&
      new Date(order.expires_at).getTime() <= Date.now();
    return {
      reference: order.invoice_reference,
      status: expired ? 'EXPIRED' : order.payment_status,
      totalNaira: Number(order.total_kobo) / 100,
      items: [
        {
          description: order.snapshot.name,
          quantity: order.quantity,
          unitPriceNaira: Number(order.unit_price_kobo) / 100,
        },
      ],
      paymentMethods: ['Debit card', 'Bank transfer', 'USSD'],
      isDemo: false,
      paystackUrl:
        !expired && order.reservation_state === 'RESERVED'
          ? order.authorization_url
          : null,
      expiresAt: new Date(order.expires_at).toISOString(),
      fulfillmentState: order.fulfillment_state,
    };
  }

  async maintenance() {
    if (this.working) return;
    this.working = true;
    try {
      await this.db.transaction(async (manager) => {
        await this.lock(manager);
        await manager.query(`UPDATE marketplace_orders SET reservation_state='RELEASED',payment_status='EXPIRED'
          WHERE reservation_state='RESERVED' AND expires_at<=now()`);
      });
      // Also keep verifying released transactions to detect late successful payments.
      const rows = await this.db.query<
        Pick<OrderRow, 'payment_reference'>[]
      >(`SELECT payment_reference FROM marketplace_orders WHERE payment_status NOT IN ('PAID','PAID_REVIEW')
        AND (last_verified_at IS NULL OR last_verified_at<now()-interval '2 minutes')
        ORDER BY last_verified_at NULLS FIRST,created_at LIMIT 20`);
      for (const row of rows) {
        try {
          await this.reconcile(row.payment_reference);
        } catch {
          await this.db.query(
            'UPDATE marketplace_orders SET last_verified_at=now() WHERE payment_reference=$1',
            [row.payment_reference],
          );
        }
      }
      await this.images.cleanupPending();
    } catch {
      this.logger.warn(
        'Marketplace maintenance could not complete; it will retry. Check migration and provider configuration.',
      );
    } finally {
      this.working = false;
    }
  }
}
