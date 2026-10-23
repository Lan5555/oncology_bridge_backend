import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { isISO8601 } from 'class-validator';
import { ResponseHelper } from '../helpers/response-helper';
import {
  CreateShipmentMonitorDto,
  ShipmentPageDto,
  UpdateShipmentMonitorDto,
} from './shipments.dto';
import { SHIPMENT_TEMPERATURE_PROVIDER } from './shipment-provider';
import type { ShipmentProvider, ShipmentReading } from './shipment-provider';

interface Monitor {
  id: string;
  order_id: string | null;
  courier_assignment_id: string | null;
  courier_id: string;
  provider: string;
  device_id: string;
  min_celsius: number;
  max_celsius: number;
  stale_after_seconds: number;
  version: number;
  created_at: Date;
  last_synced_at: Date | null;
  buyer_id: string | null;
  seller_facility: string | null;
  from_facility: string | null;
  to_facility: string | null;
  source_status: string;
  courier_name: string;
  reference: string | null;
}
const BASE = `FROM shipment_monitors s JOIN couriers c ON c.id=s.courier_id
 LEFT JOIN marketplace_orders o ON o.id=s.order_id
 LEFT JOIN courier_assignments ca ON ca.id=s.courier_assignment_id
 LEFT JOIN transfer_requests t ON t.id=ca.transfer_id`;
const SELECT = `SELECT s.*,o.buyer_id,o.facility_id seller_facility,t.from_hospital from_facility,t.to_hospital to_facility,
 COALESCE(o.order_status,CASE WHEN t.status='REJECTED' THEN 'CANCELLED' WHEN t.status IN ('DELIVERED','CANCELLED') THEN t.status ELSE ca.status END) source_status,c.name courier_name,o.invoice_reference reference ${BASE}`;
const ACTIVE = `COALESCE(o.order_status,CASE WHEN t.status='REJECTED' THEN 'CANCELLED' WHEN t.status IN ('DELIVERED','CANCELLED') THEN t.status ELSE ca.status END) NOT IN ('DELIVERED','CANCELLED')`;
const iso = (date: Date | string) => new Date(date).toISOString();

@Injectable()
export class ShipmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShipmentsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly db: DataSource,
    @Inject(SHIPMENT_TEMPERATURE_PROVIDER)
    private readonly provider: ShipmentProvider,
  ) {}
  onModuleInit() {
    if (!this.provider.configured()) return;
    this.timer = setInterval(() => void this.poll(), 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async actor(m: EntityManager, id: string, manage = false) {
    const [a] = await m.query<
      {
        id: string;
        hospital_id: string | null;
        active: boolean;
        verification_status: string;
        role: string;
        permissions: string[];
      }[]
    >(
      `SELECT u.id,u.hospital_id,u.active,u.verification_status,r.name role,
      ARRAY(SELECT permission FROM role_permissions WHERE role_id=u.role_id) permissions
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
      [id],
    );
    if (!a?.active) throw new ForbiddenException('Active account required');
    const network = [
      'ADMIN',
      'SUPERADMIN',
      'C',
      'NETWORK ADMIN',
      'NETWORK_ADMIN',
      'NETWORK-ADMIN',
    ].includes(a.role.trim().toUpperCase());
    if (
      network &&
      (!a.permissions.includes('admin.access') ||
        !a.permissions.includes(manage ? 'coldchain.manage' : 'coldchain.read'))
    )
      throw new ForbiddenException('Missing shipment monitoring permission');
    if (manage && !network)
      throw new ForbiddenException('Network monitoring operator required');
    if (!network && a.verification_status !== 'VERIFIED')
      throw new ForbiddenException('Verified account required');
    return { ...a, network };
  }
  private async monitor(
    m: EntityManager,
    id: string,
    actorId: string,
    manage = false,
  ) {
    const a = await this.actor(m, actorId, manage);
    const [s] = await m.query<Monitor[]>(`${SELECT} WHERE s.id=$1`, [id]);
    if (
      !s ||
      (!a.network &&
        !(
          s.buyer_id === a.id ||
          (a.hospital_id &&
            [s.seller_facility, s.from_facility, s.to_facility].includes(
              a.hospital_id,
            ))
        ))
    )
      throw new NotFoundException('Shipment monitoring not found');
    return s;
  }
  private settings(dto: CreateShipmentMonitorDto | UpdateShipmentMonitorDto) {
    if (!(
      Number.isFinite(dto.minCelsius) &&
      Number.isFinite(dto.maxCelsius) &&
      dto.minCelsius < dto.maxCelsius
    ))
      throw new BadRequestException(
        'A reviewed temperature range with minimum below maximum is required',
      );
  }
  private async deviceAvailable(
    m: EntityManager,
    provider: string,
    device: string,
    exclude: string | null = null,
  ) {
    const matches = await m.query<{ id: string }[]>(
      `${SELECT} WHERE lower(s.provider)=lower($1) AND s.device_id=$2 AND ($3::uuid IS NULL OR s.id<>$3) AND ${ACTIVE}`,
      [provider, device, exclude],
    );
    if (matches.length)
      throw new ConflictException(
        'This device is already assigned to an active shipment',
      );
  }
  private async audit(
    m: EntityManager,
    id: string,
    actor: string,
    action: string,
  ) {
    await m.query(
      `INSERT INTO audit_logs(id,user_id,action,description,ip_address,object_type,object_id)
     VALUES ($1,$2,$3,'Shipment temperature monitoring configuration changed','shipment-api','shipment_monitor',$4)`,
      [randomUUID(), actor, action, id],
    );
  }
  async create(actorId: string, dto: CreateShipmentMonitorDto) {
    this.settings(dto);
    if (
      Number(Boolean(dto.orderId)) +
        Number(Boolean(dto.courierAssignmentId)) !==
      1
    )
      throw new BadRequestException(
        'Provide exactly one orderId or courierAssignmentId',
      );
    return this.db.transaction(async (m) => {
      await this.actor(m, actorId, true);
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('shipment-monitor-configuration'))",
      );
      let courierId = dto.courierId;
      if (dto.orderId) {
        const [order] = await m.query<{ id: string }[]>(
          `SELECT id FROM marketplace_orders WHERE id=$1 AND payment_status='PAID' AND reservation_state='CONSUMED'
         AND fulfillment_state<>'PAYMENT_REVIEW_REQUIRED' AND order_status IN ('CONFIRMED','PROCESSING','SHIPPED') FOR SHARE`,
          [dto.orderId],
        );
        if (!order)
          throw new ConflictException(
            'A paid, fulfillable purchase order is required',
          );
        if (!courierId)
          throw new BadRequestException(
            'courierId is required for purchase order monitoring',
          );
      } else {
        if (dto.courierId)
          throw new BadRequestException(
            'The courier comes from the courier assignment',
          );
        const [assignment] = await m.query<{ courier_id: string }[]>(
          `SELECT ca.courier_id FROM courier_assignments ca JOIN transfer_requests t ON t.id=ca.transfer_id
         WHERE ca.id=$1 AND ca.status IN ('ASSIGNED','PICKED_UP') AND t.status IN ('APPROVED','IN_TRANSIT') FOR SHARE OF ca,t`,
          [dto.courierAssignmentId],
        );
        if (!assignment)
          throw new ConflictException(
            'An active courier assignment is required',
          );
        courierId = assignment.courier_id;
      }
      const [courier] = await m.query<{ id: string }[]>(
        'SELECT id FROM couriers WHERE id=$1 AND active=true FOR SHARE',
        [courierId],
      );
      if (!courier) throw new BadRequestException('Select an active courier');
      const exists = await m.query<{ id: string }[]>(
        'SELECT id FROM shipment_monitors WHERE order_id=$1 OR courier_assignment_id=$2',
        [dto.orderId ?? null, dto.courierAssignmentId ?? null],
      );
      if (exists.length)
        throw new ConflictException(
          'This shipment already has monitoring configured',
        );
      await this.deviceAvailable(m, dto.provider, dto.deviceId);
      const id = randomUUID();
      await m.query(
        `INSERT INTO shipment_monitors(id,order_id,courier_assignment_id,courier_id,provider,device_id,min_celsius,max_celsius,stale_after_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          dto.orderId ?? null,
          dto.courierAssignmentId ?? null,
          courierId,
          dto.provider,
          dto.deviceId,
          dto.minCelsius,
          dto.maxCelsius,
          dto.staleAfterSeconds,
        ],
      );
      await this.audit(m, id, actorId, 'SHIPMENT_MONITOR_CREATED');
      return ResponseHelper.Success(
        'Shipment monitoring configured; provider connectivity may still be pending.',
        await this.summary(m, await this.monitor(m, id, actorId, true)),
      );
    });
  }
  async update(actorId: string, id: string, dto: UpdateShipmentMonitorDto) {
    this.settings(dto);
    return this.db.transaction(async (m) => {
      await this.actor(m, actorId, true);
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('shipment-monitor-configuration'))",
      );
      await m.query('SELECT id FROM shipment_monitors WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      const s = await this.monitor(m, id, actorId, true);
      const readings = await m.query<{ id: string }[]>(
        'SELECT id FROM shipment_temperature_readings WHERE shipment_id=$1 LIMIT 1',
        [id],
      );
      if (
        s.version !== dto.expectedVersion ||
        readings.length ||
        ['DELIVERED', 'CANCELLED'].includes(s.source_status)
      )
        throw new ConflictException(
          'Monitoring changed, has readings, or has ended. Historical monitoring configuration cannot be rewritten.',
        );
      await this.deviceAvailable(m, dto.provider, dto.deviceId, id);
      await m.query(
        `UPDATE shipment_monitors SET provider=$2,device_id=$3,min_celsius=$4,max_celsius=$5,stale_after_seconds=$6,version=version+1 WHERE id=$1`,
        [
          id,
          dto.provider,
          dto.deviceId,
          dto.minCelsius,
          dto.maxCelsius,
          dto.staleAfterSeconds,
        ],
      );
      await this.audit(m, id, actorId, 'SHIPMENT_MONITOR_UPDATED');
      return ResponseHelper.Success(
        '',
        await this.summary(m, await this.monitor(m, id, actorId, true)),
      );
    });
  }
  private async summary(m: EntityManager, s: Monitor) {
    const [latest] = await m.query<
      {
        id: string;
        celsius: number;
        recorded_at: Date;
        received_at: Date;
        out_of_range: boolean;
      }[]
    >(
      'SELECT * FROM shipment_temperature_readings WHERE shipment_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [s.id],
    );
    const [{ total }] = await m.query<{ total: number }[]>(
      'SELECT count(*)::int total FROM shipment_temperature_events WHERE shipment_id=$1',
      [s.id],
    );
    const ended = ['DELIVERED', 'CANCELLED'].includes(s.source_status);
    const stale = latest
      ? Date.now() - new Date(latest.recorded_at).getTime() >
        s.stale_after_seconds * 1000
      : false;
    return {
      id: s.id,
      orderId: s.order_id,
      courierAssignmentId: s.courier_assignment_id,
      reference: s.reference,
      courier: { id: s.courier_id, name: s.courier_name },
      provider: s.provider,
      deviceId: s.device_id,
      version: s.version,
      shipmentStatus: s.source_status,
      monitoringStatus: ended
        ? 'ENDED'
        : !this.provider.configured()
          ? 'PENDING_INTEGRATION'
          : !latest
            ? 'AWAITING_DATA'
            : stale
              ? 'STALE'
              : 'RECEIVING',
      temperatureStatus: !latest
        ? 'NO_DATA'
        : latest.out_of_range
          ? 'OUT_OF_RANGE'
          : 'IN_RANGE',
      limits: { minCelsius: s.min_celsius, maxCelsius: s.max_celsius },
      staleAfterSeconds: s.stale_after_seconds,
      latestReading: latest
        ? {
            id: latest.id,
            celsius: latest.celsius,
            recordedAt: iso(latest.recorded_at),
            receivedAt: iso(latest.received_at),
            outOfRange: latest.out_of_range,
          }
        : null,
      excursionCount: total,
      lastSyncedAt: s.last_synced_at ? iso(s.last_synced_at) : null,
      createdAt: iso(s.created_at),
      providerConfigured: this.provider.configured(),
      pollAfterSeconds: 30,
    };
  }
  async detail(actorId: string, id: string) {
    return this.db.transaction('REPEATABLE READ', async (m) =>
      ResponseHelper.Success(
        '',
        await this.summary(m, await this.monitor(m, id, actorId)),
      ),
    );
  }
  async list(actorId: string, page: ShipmentPageDto) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const a = await this.actor(m, actorId);
      const args: unknown[] = a.network ? [] : [a.id, a.hospital_id];
      const where = a.network
        ? 'true'
        : `(o.buyer_id=$1 OR o.facility_id=$2 OR t.from_hospital=$2 OR t.to_hospital=$2)`;
      const [{ total }] = await m.query<{ total: number }[]>(
        `SELECT count(*)::int total ${BASE} WHERE ${where}`,
        args,
      );
      const rows = await m.query<Monitor[]>(
        `${SELECT} WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, page.limit, (page.page - 1) * page.limit],
      );
      const items: Awaited<ReturnType<ShipmentsService['summary']>>[] = [];
      for (const row of rows) items.push(await this.summary(m, row));
      return ResponseHelper.Success('', {
        items,
        pagination: {
          page: page.page,
          limit: page.limit,
          total,
          totalPages: Math.ceil(total / page.limit),
        },
      });
    });
  }
  async history(actorId: string, id: string, page: ShipmentPageDto) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const s = await this.monitor(m, id, actorId);
      const [{ total }] = await m.query<{ total: number }[]>(
        'SELECT count(*)::int total FROM shipment_temperature_readings WHERE shipment_id=$1',
        [id],
      );
      const rows = await m.query<
        {
          id: string;
          celsius: number;
          recorded_at: Date;
          received_at: Date;
          out_of_range: boolean;
        }[]
      >(
        'SELECT id,celsius,recorded_at,received_at,out_of_range FROM shipment_temperature_readings WHERE shipment_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT $2 OFFSET $3',
        [id, page.limit, (page.page - 1) * page.limit],
      );
      return ResponseHelper.Success('', {
        monitoringStatus: (await this.summary(m, s)).monitoringStatus,
        items: rows.map((r) => ({
          id: r.id,
          celsius: r.celsius,
          recordedAt: iso(r.recorded_at),
          receivedAt: iso(r.received_at),
          outOfRange: r.out_of_range,
        })),
        pagination: {
          page: page.page,
          limit: page.limit,
          total,
          totalPages: Math.ceil(total / page.limit),
        },
      });
    });
  }
  async sync(actorId: string, id: string) {
    const s = await this.monitor(this.db.manager, id, actorId, true);
    await this.synchronize(s);
    return this.db.transaction('REPEATABLE READ', async (m) =>
      ResponseHelper.Success(
        '',
        await this.summary(m, await this.monitor(m, id, actorId, true)),
      ),
    );
  }
  async events(actorId: string, id: string, page: ShipmentPageDto) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.monitor(m, id, actorId);
      const [{ total }] = await m.query<{ total: number }[]>(
        'SELECT count(*)::int total FROM shipment_temperature_events WHERE shipment_id=$1',
        [id],
      );
      const rows = await m.query<
        { id: string; reading_id: string; occurred_at: Date; celsius: number }[]
      >(
        `SELECT e.id,e.reading_id,e.occurred_at,r.celsius FROM shipment_temperature_events e JOIN shipment_temperature_readings r ON r.id=e.reading_id
        WHERE e.shipment_id=$1 ORDER BY e.occurred_at DESC,e.id DESC LIMIT $2 OFFSET $3`,
        [id, page.limit, (page.page - 1) * page.limit],
      );
      return ResponseHelper.Success('', {
        items: rows.map((r) => ({
          id: r.id,
          readingId: r.reading_id,
          type: 'TEMPERATURE_EXCURSION',
          message:
            'A shipment reading was outside the configured temperature range.',
          celsius: r.celsius,
          occurredAt: iso(r.occurred_at),
        })),
        pagination: {
          page: page.page,
          limit: page.limit,
          total,
          totalPages: Math.ceil(total / page.limit),
        },
      });
    });
  }
  private async synchronize(snapshot: Monitor) {
    if (!this.provider.configured())
      throw new ServiceUnavailableException(
        'Shipment temperature provider integration is pending. No live readings are available.',
      );
    if (['DELIVERED', 'CANCELLED'].includes(snapshot.source_status))
      throw new ConflictException('Shipment monitoring has ended');
    let batch: ShipmentReading[];
    try {
      batch = await this.provider.readings({
        provider: snapshot.provider,
        deviceId: snapshot.device_id,
        since: iso(snapshot.created_at),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Shipment temperature provider could not be reached or authenticated',
      );
    }
    if (!Array.isArray(batch) || batch.length > 500)
      throw new ServiceUnavailableException(
        'Shipment provider returned an invalid reading batch',
      );
    const now = Date.now();
    for (const r of batch)
      if (
        !r ||
        typeof r.eventId !== 'string' ||
        !r.eventId.trim() ||
        r.eventId.length > 160 ||
        r.deviceId !== snapshot.device_id ||
        typeof r.celsius !== 'number' ||
        !Number.isFinite(r.celsius) ||
        typeof r.recordedAt !== 'string' ||
        !isISO8601(r.recordedAt, { strict: true }) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(r.recordedAt) ||
        new Date(r.recordedAt).getTime() <
          new Date(snapshot.created_at).getTime() ||
        new Date(r.recordedAt).getTime() > now
      )
        throw new ServiceUnavailableException(
          'Shipment provider returned invalid device, timestamp or temperature data',
        );
    await this.db.transaction(async (m) => {
      await m.query('SELECT id FROM shipment_monitors WHERE id=$1 FOR UPDATE', [
        snapshot.id,
      ]);
      if (snapshot.order_id)
        await m.query(
          'SELECT id FROM marketplace_orders WHERE id=$1 FOR SHARE',
          [snapshot.order_id],
        );
      else
        await m.query(
          'SELECT ca.id FROM courier_assignments ca JOIN transfer_requests t ON t.id=ca.transfer_id WHERE ca.id=$1 FOR SHARE OF ca,t',
          [snapshot.courier_assignment_id],
        );
      const [s] = await m.query<Monitor[]>(`${SELECT} WHERE s.id=$1`, [
        snapshot.id,
      ]);
      if (
        s.version !== snapshot.version ||
        ['DELIVERED', 'CANCELLED'].includes(s.source_status)
      )
        throw new ConflictException(
          'Shipment monitoring changed during synchronization',
        );
      for (const r of batch) {
        const out = r.celsius < s.min_celsius || r.celsius > s.max_celsius;
        const id = randomUUID();
        const inserted = await m.query<{ id: string }[]>(
          `INSERT INTO shipment_temperature_readings(id,shipment_id,provider_event_id,celsius,recorded_at,out_of_range)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(shipment_id,provider_event_id) DO NOTHING RETURNING id`,
          [id, s.id, r.eventId, r.celsius, r.recordedAt, out],
        );
        if (!inserted.length) {
          const [old] = await m.query<{ celsius: number; recorded_at: Date }[]>(
            'SELECT celsius,recorded_at FROM shipment_temperature_readings WHERE shipment_id=$1 AND provider_event_id=$2',
            [s.id, r.eventId],
          );
          if (
            old.celsius !== r.celsius ||
            new Date(old.recorded_at).getTime() !==
              new Date(r.recordedAt).getTime()
          )
            throw new ConflictException(
              'Provider reused a reading identifier with different data',
            );
        } else if (out) {
          const eventId = randomUUID();
          await m.query(
            `INSERT INTO shipment_temperature_events(id,shipment_id,reading_id,type,occurred_at) VALUES($1,$2,$3,'TEMPERATURE_EXCURSION',$4)`,
            [eventId, s.id, id, r.recordedAt],
          );
          await m.query(
            `INSERT INTO notifications(id,user_id,title,message,shipment_temperature_event_id)
            SELECT gen_random_uuid(),u.id,'Shipment temperature alert','A shipment reading was outside its configured range. Review shipment ' || $1::text || '.',$2
            FROM users u WHERE u.active=true AND u.verification_status='VERIFIED' AND
            (u.id=$3 OR u.hospital_id IN ($4,$5,$6))`,
            [
              s.id,
              eventId,
              s.buyer_id,
              s.seller_facility,
              s.from_facility,
              s.to_facility,
            ],
          );
        }
      }
      await m.query(
        'UPDATE shipment_monitors SET last_synced_at=clock_timestamp() WHERE id=$1',
        [s.id],
      );
    });
  }
  async poll() {
    if (this.running || !this.provider.configured()) return;
    this.running = true;
    try {
      const rows = await this.db.query<Monitor[]>(
        `${SELECT} WHERE ${ACTIVE} AND (s.last_synced_at IS NULL OR s.last_synced_at<now()-interval '30 seconds') ORDER BY s.last_synced_at NULLS FIRST,s.created_at LIMIT 20`,
      );
      for (const s of rows) {
        try {
          await this.synchronize(s);
        } catch {
          this.logger.warn(
            'Shipment temperature synchronization failed; no live status is inferred.',
          );
        }
      }
    } catch {
      this.logger.warn('Shipment monitoring could not load active shipments.');
    } finally {
      this.running = false;
    }
  }
}
