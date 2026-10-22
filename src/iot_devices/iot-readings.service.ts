import { isISO8601 } from 'class-validator';
import { readingPresentation } from '../storage_units/reading-presentation';
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { IotDevice } from './entities/iot-device.entity';
import { IotDeviceUnit } from './entities/iot-device-unit.entity';
import { IotRequestNonce } from './entities/iot-request-nonce.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { TemperatureLog } from '../temperature_log/entities/temperature_log.entity';
import { ColdChainEvent } from '../cold_chain_events/entities/cold-chain-event.entity';
import { ColdChainOutbox } from '../cold_chain_events/entities/cold-chain-outbox.entity';
import {
  ColdChainEventBus,
  ColdChainStreamEvent,
} from '../cold_chain_events/cold-chain-event-bus';
import { Inventory } from '../inventory/entities/inventory.entity';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notification/entities/notification.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { ResponseHelper } from '../helpers/response-helper';

interface IngestReading {
  unitId: string;
  celsius: number;
  recordedAt: string;
  sequence: number;
}
interface SignedHeaders {
  deviceId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}
interface TransitionOutbox {
  id: string;
  stream_id: string;
  event_type: string;
  unit_id: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class IotReadingsService implements OnModuleInit, OnModuleDestroy {
  private heartbeatTimer?: NodeJS.Timeout;
  private outboxTimer?: NodeJS.Timeout;
  private readonly rateBuckets = new Map<string, number[]>();
  private readonly counters = {
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    delayed: 0,
    breaches: 0,
    offline: 0,
    outboxFailures: 0,
  };

  constructor(
    @InjectRepository(IotDevice)
    private readonly devices: Repository<IotDevice>,
    @InjectRepository(IotDeviceUnit)
    private readonly assignments: Repository<IotDeviceUnit>,
    @InjectRepository(IotRequestNonce)
    private readonly nonces: Repository<IotRequestNonce>,
    @InjectRepository(StorageUnit)
    private readonly units: Repository<StorageUnit>,
    @InjectRepository(TemperatureLog)
    private readonly readings: Repository<TemperatureLog>,
    @InjectRepository(ColdChainOutbox)
    private readonly outbox: Repository<ColdChainOutbox>,
    private readonly dataSource: DataSource,
    private readonly bus: ColdChainEventBus,
  ) {}

  onModuleInit() {
    this.outboxTimer = setInterval(() => void this.processOutbox(), 10_000);
    this.heartbeatTimer = setInterval(
      () => void this.checkOfflineUnits(),
      30_000,
    );
    this.outboxTimer.unref();
    this.heartbeatTimer.unref();
  }

  onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async ingest(
    headers: SignedHeaders,
    rawBody: Buffer | undefined,
    payload: unknown,
    ipAddress: string,
  ) {
    try {
      const device = await this.authenticate(headers, rawBody, ipAddress);
      const readings = this.validateBatch(device, payload);
      const result = await this.persistBatch(device, readings);
      this.counters.accepted += result.accepted;
      this.counters.duplicates += result.duplicates;
      this.counters.breaches += result.breachTransitions;
      this.counters.delayed += result.delayed;
      for (const event of result.events) this.publish(event);
      void this.processOutbox();
      return ResponseHelper.Success('IoT readings accepted', {
        accepted: result.accepted,
        duplicates: result.duplicates,
        eventIds: result.eventIds,
      });
    } catch (error) {
      this.counters.rejected++;
      throw error;
    }
  }

  metrics() {
    return {
      accepted: this.counters.accepted,
      rejected: this.counters.rejected,
      duplicate: this.counters.duplicates,
      delayed: this.counters.delayed,
      breach: this.counters.breaches,
      offline: this.counters.offline,
      outboxFailures: this.counters.outboxFailures,
    };
  }

  credentialFingerprint(secretRef: string) {
    const secret = this.resolveSecret(secretRef);
    if (!secret)
      throw new ConflictException(
        'The referenced device secret is not configured on this server.',
      );
    return createHash('sha256').update(secret).digest('hex');
  }

  private async authenticate(
    headers: SignedHeaders,
    rawBody: Buffer | undefined,
    ipAddress: string,
  ) {
    const { deviceId, timestamp, nonce, signature } = headers;
    if (!deviceId || !timestamp || !nonce || !signature || !rawBody?.length)
      throw new UnauthorizedException(
        'Signed device headers and raw request body are required.',
      );
    if (!/^[A-Za-z0-9._~-]{16,160}$/.test(nonce))
      throw new UnauthorizedException('Invalid device request nonce.');
    const sentAt = /^\d+$/.test(timestamp)
      ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1)
      : Date.parse(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000)
      throw new UnauthorizedException(
        'Device request timestamp is outside the allowed window.',
      );

    const device = await this.devices.findOne({
      where: { device_id: deviceId },
      relations: { facility: true, units: { unit: true } },
    });
    if (!device || !device.active || device.revoked_at)
      throw new UnauthorizedException('Unknown or revoked IoT device.');
    const bucket = (this.rateBuckets.get(device.id) ?? []).filter(
      (at) => Date.now() - at < 60_000,
    );
    const limit = Math.max(
      1,
      Number(process.env.IOT_RATE_LIMIT_PER_MINUTE) || 300,
    );
    if (bucket.length >= limit)
      throw new HttpException('Device ingest rate limit exceeded.', 429);
    bucket.push(Date.now());
    this.rateBuckets.set(device.id, bucket);
    const secret = this.resolveSecret(device.secret_ref);
    if (!secret)
      throw new UnauthorizedException('IoT device credential is unavailable.');
    const fingerprint = createHash('sha256').update(secret).digest('hex');
    if (!this.constantTimeEqual(fingerprint, device.secret_fingerprint))
      throw new UnauthorizedException('IoT device credential is invalid.');

    const suppliedSignature = signature.replace(/^sha256=/i, '').toLowerCase();
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.`)
      .update(rawBody)
      .digest('hex');
    if (!this.constantTimeEqual(expected, suppliedSignature))
      throw new UnauthorizedException('Invalid IoT request signature.');

    try {
      await this.nonces.save(
        this.nonces.create({
          device_id: device.id,
          nonce,
          expires_at: new Date(Date.now() + 10 * 60_000),
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException(
          'Device request nonce has already been used.',
        );
      throw error;
    }
    void ipAddress; // Request addresses are intentionally not logged with credentials.
    return device;
  }

  private validateBatch(device: IotDevice, payload: unknown): IngestReading[] {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as { readings?: unknown }).readings)
    )
      throw new BadRequestException('Request must contain a readings array.');
    const source = (payload as { readings: unknown[] }).readings;
    if (!source.length || source.length > 100)
      throw new BadRequestException(
        'Readings array must contain 1 to 100 readings.',
      );
    const permitted = new Map(
      device.units.map((assignment) => [assignment.unit.id, assignment.unit]),
    );
    const normalized: IngestReading[] = source.map((value) => {
      if (!value || typeof value !== 'object')
        throw new BadRequestException('Invalid reading item.');
      const row = value as Partial<IngestReading>;
      if (
        typeof row.unitId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(row.unitId)
      )
        throw new BadRequestException('Reading unitId must be a UUID.');
      if (typeof row.celsius !== 'number' || !Number.isFinite(row.celsius))
        throw new BadRequestException(
          'Reading celsius must be a finite number.',
        );
      if (
        row.celsius < Number(device.sensor_min_celsius) ||
        row.celsius > Number(device.sensor_max_celsius)
      )
        throw new BadRequestException(
          'Reading is outside the registered sensor limits.',
        );
      if (
        typeof row.recordedAt !== 'string' ||
        !isISO8601(row.recordedAt, { strict: true, strictSeparator: true }) ||
        !/(?:Z|[+-]\d{2}:\d{2})$/.test(row.recordedAt) ||
        Number.isNaN(Date.parse(row.recordedAt))
      )
        throw new BadRequestException(
          'Reading recordedAt must be a valid ISO timestamp.',
        );
      if (!Number.isSafeInteger(row.sequence) || Number(row.sequence) < 1)
        throw new BadRequestException(
          'Reading sequence must be a positive safe integer.',
        );
      const unit = permitted.get(row.unitId);
      if (!unit || unit.facility_id !== device.facility_id)
        throw new ForbiddenException(
          'Device is not assigned to this storage unit.',
        );
      return {
        unitId: row.unitId,
        celsius: row.celsius,
        recordedAt: new Date(row.recordedAt).toISOString(),
        sequence: Number(row.sequence),
      };
    });
    const sequences = new Map<number, string>();
    for (const row of normalized) {
      const signature = `${row.unitId}|${row.celsius}|${row.recordedAt}`;
      const previous = sequences.get(row.sequence);
      if (previous && previous !== signature)
        throw new ConflictException(
          'A sequence number is repeated with different reading data.',
        );
      sequences.set(row.sequence, signature);
    }
    return normalized;
  }

  private async persistBatch(device: IotDevice, items: IngestReading[]) {
    const existing = new Map<string, TemperatureLog>();
    const duplicatesInPayload = new Set<number>();
    for (const row of items) {
      const sequence = String(row.sequence);
      const duplicate = await this.readings.findOne({
        where: { device: { id: device.id }, sequence },
        relations: { unit: true },
      });
      if (duplicate) {
        if (
          duplicate.unit?.id !== row.unitId ||
          Number(duplicate.temperature) !== row.celsius ||
          new Date(duplicate.recorded_at).toISOString() !== row.recordedAt
        )
          throw new ConflictException(
            'A device sequence was already used for different reading data.',
          );
        existing.set(sequence, duplicate);
      }
      if (
        items.filter((candidate) => candidate.sequence === row.sequence)
          .length > 1
      )
        duplicatesInPayload.add(row.sequence);
    }
    const pending = items.filter(
      (row) =>
        !existing.has(String(row.sequence)) &&
        !duplicatesInPayload.has(row.sequence),
    );
    const unitMap = new Map(
      device.units.map((assignment) => [assignment.unit.id, assignment.unit]),
    );
    const now = Date.now();
    const result = await this.dataSource.transaction(async (manager) => {
      const readingRepo = manager.getRepository(TemperatureLog);
      const unitRepo = manager.getRepository(StorageUnit);
      const eventRepo = manager.getRepository(ColdChainEvent);
      const outboxRepo = manager.getRepository(ColdChainOutbox);
      const inventoryRepo = manager.getRepository(Inventory);
      const events: ColdChainStreamEvent[] = [];
      const eventIds = new Set<string>();
      let breachTransitions = 0;
      let delayed = 0;

      for (const row of pending) {
        const unit = unitMap.get(row.unitId)!;
        const readingDate = new Date(row.recordedAt);
        if (
          now - readingDate.getTime() >
          Number(device.expected_interval_seconds) * 1000
        )
          delayed++;
        const saved = await readingRepo.save(
          readingRepo.create({
            transfer: null,
            unit,
            device,
            sequence: String(row.sequence),
            temperature: row.celsius,
            recorded_at: readingDate,
          }),
        );
        if (!unit.last_seen_at || readingDate > unit.last_seen_at)
          unit.last_seen_at = readingDate;
        unit.operational_state = 'ONLINE';
        await unitRepo.save(unit);

        const presentation = readingPresentation({
          temperature: row.celsius,
          recordedAt: row.recordedAt,
          targetMin: unit.target_min,
          targetMax: unit.target_max,
        });
        const readingPayload = {
          readingId: saved.id,
          unitId: unit.id,
          facilityId: unit.facility_id,
          unitLabel: unit.label,
          celsius: row.celsius,
          recordedAt: row.recordedAt,
          sequence: row.sequence,
          targetMin: presentation.targetMin,
          targetMax: presentation.targetMax,
          readingState: presentation.readingState,
        };
        const streamReading = await outboxRepo.save(
          outboxRepo.create({
            event_type: 'reading',
            unit_id: unit.id,
            payload: readingPayload,
          }),
        );
        events.push(this.toStreamEvent(streamReading));

        const breached = presentation.readingState === 'BREACH';
        if (breached) {
          const inventory = await inventoryRepo.find({
            where: { storage_unit_id: unit.id },
          });
          const affected = inventory.filter(
            (item) => item.status !== 'QUARANTINED',
          );
          for (const item of affected) item.status = 'QUARANTINED';
          if (affected.length) await inventoryRepo.save(affected);

          let event = await eventRepo.findOne({
            where: { unit: { id: unit.id }, severity: 'BREACH', state: 'OPEN' },
            lock: { mode: 'pessimistic_write' },
          });
          const transition = !event;
          const allAffected = new Set([
            ...(event?.affected_inventory_ids ?? []),
            ...affected.map((item) => item.id),
          ]);
          if (!event) {
            event = eventRepo.create({
              unit,
              severity: 'BREACH',
              message: `Temperature ${row.celsius}°C outside ${unit.target_min}–${unit.target_max}°C.`,
              action_taken: 'Affected linked inventory quarantined.',
              state: 'OPEN',
              at: readingDate,
              last_seen_at: readingDate,
              resolved_at: null,
              observed_min_celsius: row.celsius,
              observed_max_celsius: row.celsius,
              affected_inventory_ids: [...allAffected],
            });
          } else {
            event.last_seen_at = readingDate;
            event.observed_min_celsius = Math.min(
              Number(event.observed_min_celsius ?? row.celsius),
              row.celsius,
            );
            event.observed_max_celsius = Math.max(
              Number(event.observed_max_celsius ?? row.celsius),
              row.celsius,
            );
            event.affected_inventory_ids = [...allAffected];
            event.message = `Temperature breach remains open; latest reading ${row.celsius}°C.`;
          }
          event = await eventRepo.save(event);
          eventIds.add(event.id);
          if (transition) {
            breachTransitions++;
            const outbox = await outboxRepo.save(
              outboxRepo.create({
                event_type: 'breach',
                unit_id: unit.id,
                payload: {
                  eventId: event.id,
                  unitId: unit.id,
                  facilityId: unit.facility_id,
                  unitLabel: unit.label,
                  severity: event.severity,
                  message: event.message,
                  actionTaken: event.action_taken,
                  at: event.at,
                },
              }),
            );
            events.push(this.toStreamEvent(outbox));
          }
        } else if (presentation.readingState === 'NOMINAL') {
          const openBreach = await eventRepo.findOne({
            where: { unit: { id: unit.id }, severity: 'BREACH', state: 'OPEN' },
          });
          if (openBreach) {
            openBreach.state = 'RESOLVED';
            openBreach.resolved_at = readingDate;
            openBreach.last_seen_at = readingDate;
            openBreach.action_taken =
              'In-range reading received; linked inventory reviewed.';
            await eventRepo.save(openBreach);
            const otherOpen = await eventRepo.count({
              where: { unit: { id: unit.id }, state: 'OPEN' },
            });
            if (!otherOpen && openBreach.affected_inventory_ids.length) {
              await inventoryRepo
                .createQueryBuilder()
                .update(Inventory)
                .set({ status: 'AVAILABLE' })
                .where('id IN (:...ids)', {
                  ids: openBreach.affected_inventory_ids,
                })
                .andWhere('status = :status', { status: 'QUARANTINED' })
                .execute();
            }
            eventIds.add(openBreach.id);
            const outbox = await outboxRepo.save(
              outboxRepo.create({
                event_type: 'resolved',
                unit_id: unit.id,
                payload: {
                  eventId: openBreach.id,
                  unitId: unit.id,
                  facilityId: unit.facility_id,
                  unitLabel: unit.label,
                  severity: openBreach.severity,
                  message: 'Cold-chain breach resolved by an in-range reading.',
                  actionTaken: openBreach.action_taken,
                  at: readingDate,
                  resolvedAt: readingDate,
                },
              }),
            );
            events.push(this.toStreamEvent(outbox));
          }
        }

        const offlineEvent = await eventRepo.findOne({
          where: { unit: { id: unit.id }, severity: 'OFFLINE', state: 'OPEN' },
        });
        if (offlineEvent) {
          offlineEvent.state = 'RESOLVED';
          offlineEvent.resolved_at = new Date();
          offlineEvent.last_seen_at = new Date();
          offlineEvent.action_taken = 'Authenticated device readings resumed.';
          await eventRepo.save(offlineEvent);
          const outbox = await outboxRepo.save(
            outboxRepo.create({
              event_type: 'unit-status',
              unit_id: unit.id,
              payload: {
                eventId: offlineEvent.id,
                unitId: unit.id,
                facilityId: unit.facility_id,
                unitLabel: unit.label,
                status: 'ONLINE',
                message: 'Authenticated readings resumed.',
                at: new Date().toISOString(),
              },
            }),
          );
          events.push(this.toStreamEvent(outbox));
          eventIds.add(offlineEvent.id);
        }
      }
      return { events, eventIds: [...eventIds], breachTransitions, delayed };
    });

    return {
      accepted: pending.length,
      duplicates: items.length - pending.length,
      eventIds: result.eventIds,
      events: result.events,
      breachTransitions: result.breachTransitions,
      delayed: result.delayed,
    };
  }

  private async processOutbox() {
    const pending = await this.outbox
      .find({
        where: { processed: false },
        order: { created_at: 'ASC' },
        take: 50,
      })
      .catch(() => []);
    for (const row of pending) {
      try {
        await this.dataSource.transaction(async (manager) => {
          const outboxRepo = manager.getRepository(ColdChainOutbox);
          const locked = await outboxRepo.findOne({
            where: { id: row.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked || locked.processed) return;
          if (
            ['breach', 'resolved', 'unit-status'].includes(locked.event_type)
          ) {
            const unit = await manager
              .getRepository(StorageUnit)
              .findOneBy({ id: locked.unit_id });
            if (unit) {
              const recipients = await manager.getRepository(User).find({
                where: { hospital: { id: unit.facility_id }, active: true },
              });
              const title =
                locked.event_type === 'breach'
                  ? 'Cold-chain temperature breach'
                  : locked.event_type === 'resolved'
                    ? 'Cold-chain breach resolved'
                    : locked.payload.status === 'OFFLINE'
                      ? 'Storage unit offline'
                      : locked.payload.status === 'ONLINE'
                        ? 'Storage unit online'
                        : 'Storage unit status update';
              const message =
                typeof locked.payload.message === 'string'
                  ? locked.payload.message
                  : 'Storage-unit status changed.';
              const notifications = recipients.map((user) =>
                manager.getRepository(Notification).create({
                  user,
                  title,
                  message,
                  read: false,
                  cold_chain_outbox_id: locked.id,
                }),
              );
              if (notifications.length)
                await manager.getRepository(Notification).save(notifications);
              await manager.getRepository(AuditLog).save(
                manager.getRepository(AuditLog).create({
                  user: null,
                  action:
                    locked.event_type === 'breach' ||
                    locked.event_type === 'resolved'
                      ? 'BREACH_ALERT'
                      : 'COLD_CHAIN_UNIT_STATUS',
                  description: JSON.stringify({
                    ...locked.payload,
                    unitId: unit.id,
                    deviceEventId: locked.id,
                  }),
                  ip_address: 'iot-device',
                  event_key: locked.id,
                }),
              );
            }
          }
          locked.processed = true;
          locked.processed_at = new Date();
          locked.attempts += 1;
          locked.last_error = null;
          await outboxRepo.save(locked);
        });
        const current = await this.outbox.findOneBy({ id: row.id });
        if (current?.processed) this.publish(this.toStreamEvent(current));
      } catch (error) {
        this.counters.outboxFailures++;
        await this.outbox
          .update(row.id, {
            attempts: row.attempts + 1,
            last_error:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Outbox processing failed',
          })
          .catch(() => undefined);
      }
    }
  }

  private async checkOfflineUnits() {
    const now = Date.now();
    const units = await this.units.find().catch(() => []);
    for (const unit of units) {
      const last =
        unit.last_seen_at?.getTime() ?? unit.created_at?.getTime() ?? now;
      const offline = now - last > Number(unit.offline_after_seconds) * 1000;
      if (!offline || unit.operational_state === 'OFFLINE') continue;
      try {
        await this.dataSource.transaction(async (manager) => {
          const unitRepo = manager.getRepository(StorageUnit);
          const eventRepo = manager.getRepository(ColdChainEvent);
          const outboxRepo = manager.getRepository(ColdChainOutbox);
          const current = await unitRepo.findOneBy({ id: unit.id });
          if (!current || current.operational_state === 'OFFLINE') return;
          current.operational_state = 'OFFLINE';
          await unitRepo.save(current);
          let event = await eventRepo.findOne({
            where: {
              unit: { id: unit.id },
              severity: 'OFFLINE',
              state: 'OPEN',
            },
          });
          if (event) return;
          event = await eventRepo.save(
            eventRepo.create({
              unit: current,
              severity: 'OFFLINE',
              message: `No authenticated reading received within ${unit.offline_after_seconds} seconds.`,
              action_taken: 'Investigate sensor connectivity.',
              state: 'OPEN',
              at: new Date(),
              last_seen_at: new Date(),
              resolved_at: null,
              observed_min_celsius: null,
              observed_max_celsius: null,
              affected_inventory_ids: [],
            }),
          );
          const outbox = await outboxRepo.save(
            outboxRepo.create({
              event_type: 'unit-status',
              unit_id: unit.id,
              payload: {
                eventId: event.id,
                unitId: unit.id,
                facilityId: unit.facility_id,
                unitLabel: unit.label,
                status: 'OFFLINE',
                message: event.message,
                at: event.at,
              },
            }),
          );
          this.counters.offline++;
          setImmediate(() => this.publish(this.toStreamEvent(outbox)));
        });
      } catch {
        // The next heartbeat sweep retries; no status change is lost silently.
      }
    }
    await this.nonces
      .createQueryBuilder()
      .delete()
      .where('expires_at <= :now', { now: new Date(now) })
      .execute()
      .catch(() => undefined);
  }

  private resolveSecret(secretRef: string) {
    const configured = process.env.IOT_DEVICE_KEYS;
    if (!configured) return process.env[secretRef];
    try {
      const keys = JSON.parse(configured) as Record<string, unknown>;
      const secret = keys[secretRef];
      return typeof secret === 'string' ? secret : undefined;
    } catch {
      return undefined;
    }
  }

  private constantTimeEqual(left: string, right: string) {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private isUniqueViolation(error: unknown) {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    );
  }

  private toStreamEvent(row: TransitionOutbox): {
    id: string;
    type: ColdChainStreamEvent['type'];
    unitId: string;
    facilityId: string;
    data: Record<string, unknown>;
  } {
    return {
      id: String(row.stream_id),
      type: row.event_type as ColdChainStreamEvent['type'],
      unitId: row.unit_id,
      facilityId:
        typeof row.payload.facilityId === 'string'
          ? row.payload.facilityId
          : '',
      data: row.payload,
    };
  }

  private publish(event: ReturnType<IotReadingsService['toStreamEvent']>) {
    this.bus.publish(event);
  }
}
