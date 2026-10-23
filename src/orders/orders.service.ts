import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ResponseHelper } from '../helpers/response-helper';
import { FulfillmentDto, OrderQueryDto } from './orders.dto';
import { OrderTrackingService } from './order-tracking.service';

interface PurchaseRow {
  id: string;
  buyer_id: string;
  invoice_reference: string;
  created_at: Date;
  updated_at: Date;
  order_status: string;
  payment_status: string;
  reservation_state: string;
  fulfillment_state: string;
  version: number;
  currency: string | null;
  total_kobo: string | null;
  unit_price_kobo: string | null;
  fees_kobo: string | null;
  quantity: number;
  payment_reference: string | null;
  paid_at: Date | null;
  buyer_snapshot: { name: string; facilityName: string | null } | null;
  snapshot: {
    name?: string;
    strength?: string;
    unit?: string;
    deliveryFeeKobo?: number;
    seller?: { name: string };
  };
  delivery: Record<string, string | null> | null;
}
const paymentStatusSql = `CASE WHEN payment_status IN ('PAID','PAID_REVIEW') THEN 'PAID'
 WHEN payment_status='PAYMENT_FAILED' THEN 'FAILED'
 WHEN payment_status IN ('REFUNDED','PARTIALLY_REFUNDED') THEN payment_status ELSE 'PENDING' END`;
const minor = (value: string | null) => (value === null ? null : Number(value));
const iso = (value: Date | string) => new Date(value).toISOString();

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DataSource,
    private readonly tracking: OrderTrackingService,
  ) {}

  private async authorize(
    manager: EntityManager,
    actorId: string,
    admin: boolean,
    manage = false,
  ) {
    const [actor] = await manager.query<
      { active: boolean; role: string; permissions: string[] }[]
    >(
      `SELECT u.active,r.name role,ARRAY(SELECT permission FROM role_permissions WHERE role_id=u.role_id) permissions
       FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
      [actorId],
    );
    if (!actor?.active) throw new ForbiddenException('Active account required');
    if (!admin) return false;
    // These are network-wide roles. Facility administrators never inherit network order scope.
    if (
      ![
        'ADMIN',
        'SUPERADMIN',
        'C',
        'NETWORK ADMIN',
        'NETWORK_ADMIN',
        'NETWORK-ADMIN',
      ].includes(actor.role.trim().toUpperCase()) ||
      !actor.permissions.includes('admin.access') ||
      !actor.permissions.includes(manage ? 'order.manage' : 'order.read')
    )
      throw new ForbiddenException('Insufficient purchase order permissions');
    return actor.permissions.includes('order.manage');
  }

  async list(actorId: string, query: OrderQueryDto, admin = false) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorize(manager, actorId, admin);
      const args: unknown[] = [];
      const param = (value: unknown) => {
        args.push(value);
        return `$${args.length}`;
      };
      const where = ['true'];
      if (!admin) where.push(`buyer_id=${param(actorId)}`);
      if (query.status) where.push(`order_status=${param(query.status)}`);
      if (query.paymentStatus)
        where.push(`(${paymentStatusSql})=${param(query.paymentStatus)}`);
      if (query.q) {
        const q = param(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
        where.push(
          `(invoice_reference ILIKE ${q} OR snapshot->>'name' ILIKE ${q}${admin ? ` OR buyer_snapshot->>'name' ILIKE ${q} OR buyer_snapshot->>'facilityName' ILIKE ${q}` : ''})`,
        );
      }
      const base = `FROM marketplace_orders WHERE ${where.join(' AND ')}`;
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int total ${base}`,
        args,
      );
      const page = query.page ?? 1,
        limit = query.limit ?? 20;
      const rows = await manager.query<PurchaseRow[]>(
        `SELECT * ${base} ORDER BY created_at DESC,id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, (page - 1) * limit],
      );
      return ResponseHelper.Success('', {
        items: rows.map((row) => this.summary(row)),
        pagination: {
          page,
          limit,
          total: count.total,
          totalPages: Math.ceil(count.total / limit),
        },
      });
    });
  }

  private summary(row: PurchaseRow) {
    const paymentStatus = ['PAID', 'PAID_REVIEW'].includes(row.payment_status)
      ? 'PAID'
      : row.payment_status === 'PAYMENT_FAILED'
        ? 'FAILED'
        : ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(row.payment_status)
          ? row.payment_status
          : 'PENDING';
    return {
      id: row.id,
      reference: row.invoice_reference,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      status: row.order_status,
      paymentStatus,
      currency: row.currency,
      totalMinor: minor(row.total_kobo),
      buyer: {
        name: row.buyer_snapshot?.name ?? '',
        facilityName: row.buyer_snapshot?.facilityName ?? null,
      },
      seller: { name: row.snapshot.seller?.name ?? '' },
      itemCount: 1,
    };
  }

  private transitions(row: PurchaseRow, manage: boolean): string[] {
    if (
      !manage ||
      row.payment_status !== 'PAID' ||
      row.reservation_state !== 'CONSUMED' ||
      row.fulfillment_state === 'PAYMENT_REVIEW_REQUIRED'
    )
      return [];
    const next: Record<string, string> = {
      CONFIRMED: 'PROCESSING',
      PROCESSING: 'SHIPPED',
      SHIPPED: 'DELIVERED',
    };
    return next[row.order_status] ? [next[row.order_status]] : [];
  }

  private async read(
    manager: EntityManager,
    id: string,
    actorId: string,
    admin: boolean,
    lock = false,
  ) {
    const [row] = await manager.query<PurchaseRow[]>(
      `SELECT * FROM marketplace_orders WHERE id=$1${admin ? '' : ' AND buyer_id=$2'}${lock ? ' FOR UPDATE' : ''}`,
      admin ? [id] : [id, actorId],
    );
    if (!row) throw new NotFoundException('Purchase order not found');
    return row;
  }

  private async detailData(
    manager: EntityManager,
    row: PurchaseRow,
    manage: boolean,
  ) {
    const events = await manager.query<
      { id: string; status: string; message: string; occurred_at: Date }[]
    >(
      'SELECT id,status,message,occurred_at FROM purchase_order_events WHERE order_id=$1 ORDER BY occurred_at,sequence',
      [row.id],
    );
    const unit = minor(row.unit_price_kobo);
    return {
      ...this.summary(row),
      version: row.version,
      items: [
        {
          id: row.id,
          name: row.snapshot.name ?? '',
          strength: row.snapshot.strength || null,
          quantity: row.quantity,
          unit: row.snapshot.unit ?? null,
          unitPriceMinor: unit,
          totalMinor: unit === null ? null : unit * row.quantity,
        },
      ],
      subtotalMinor: unit === null ? null : unit * row.quantity,
      deliveryFeeMinor: row.snapshot.deliveryFeeKobo ?? null,
      paymentReference: row.payment_reference,
      paidAt: row.paid_at ? iso(row.paid_at) : null,
      delivery: row.delivery
        ? {
            recipientName: row.delivery.recipientName ?? null,
            address: row.delivery.address ?? null,
            carrier: row.delivery.carrier ?? null,
            trackingNumber: row.delivery.trackingNumber ?? null,
            estimatedDeliveryAt: row.delivery.estimatedDeliveryAt ?? null,
            deliveredAt: row.delivery.deliveredAt ?? null,
          }
        : null,
      timeline: events.map((e) => ({
        id: e.id,
        status: e.status,
        message: e.message,
        occurredAt: iso(e.occurred_at),
      })),
      allowedTransitions: this.transitions(row, manage),
    };
  }

  async detail(actorId: string, id: string, admin = false) {
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const manage = await this.authorize(manager, actorId, admin);
      return ResponseHelper.Success(
        '',
        await this.detailData(
          manager,
          await this.read(manager, id, actorId, admin),
          admin && manage,
        ),
      );
    });
  }

  async fulfill(actorId: string, id: string, dto: FulfillmentDto, ip: string) {
    if (
      dto.status !== 'SHIPPED' &&
      (dto.carrier !== undefined || dto.trackingNumber !== undefined)
    )
      throw new BadRequestException(
        'Carrier and tracking number are only accepted for SHIPPED',
      );
    return this.db.transaction(async (manager) => {
      await this.authorize(manager, actorId, true, true);
      const row = await this.read(manager, id, actorId, true, true);
      if (
        row.version !== dto.expectedVersion ||
        !this.transitions(row, true).includes(dto.status)
      )
        throw new ConflictException(
          'Order changed or transition is no longer available. Reload and review the order.',
        );
      const delivery = { ...row.delivery };
      if (dto.status === 'SHIPPED') {
        delivery.carrier = dto.carrier!;
        delivery.trackingNumber = dto.trackingNumber!;
      }
      if (dto.status === 'DELIVERED')
        delivery.deliveredAt = new Date().toISOString();
      const [updated] = await manager.query<PurchaseRow[]>(
        `UPDATE marketplace_orders SET order_status=$2,fulfillment_state=$2,
        version=version+1,updated_at=now(),delivery=$3 WHERE id=$1 RETURNING *`,
        [id, dto.status, Object.keys(delivery).length ? delivery : null],
      );
      await this.tracking.event(
        manager,
        id,
        `fulfillment:${updated.version}`,
        dto.status,
        dto.note,
        actorId,
        row.order_status,
        ip,
        ['SHIPPED', 'DELIVERED'].includes(dto.status),
      );
      return ResponseHelper.Success(
        '',
        await this.detailData(manager, updated, true),
      );
    });
  }
}
