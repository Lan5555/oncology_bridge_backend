/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-misused-promises */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  MessageEvent,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import { ColdChainEvent } from './entities/cold-chain-event.entity';
import { ColdChainOutbox } from './entities/cold-chain-outbox.entity';
import {
  ColdChainEventBus,
  ColdChainStreamEvent,
} from './cold-chain-event-bus';
import { User } from '../users/entities/user.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class ColdChainEventsService {
  constructor(
    @InjectRepository(ColdChainEvent)
    private readonly events: Repository<ColdChainEvent>,
    @InjectRepository(ColdChainOutbox)
    private readonly outbox: Repository<ColdChainOutbox>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(StorageUnit)
    private readonly units: Repository<StorageUnit>,
    private readonly bus: ColdChainEventBus,
  ) {}

  async all(
    actorId: string,
    filters: {
      unitId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const actor = await this.actor(actorId);
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const query = this.events
      .createQueryBuilder('event')
      .innerJoinAndSelect('event.unit', 'unit')
      .orderBy('event.at', 'DESC');
    if (filters.unitId && !/^[0-9a-f-]{36}$/i.test(filters.unitId))
      throw new BadRequestException('unitId must be a UUID.');
    if (!this.isNetworkAdmin(actor)) {
      if (!actor.hospital?.id)
        throw new ForbiddenException('Account has no facility scope.');
      query.andWhere('unit.facility_id = :facilityId', {
        facilityId: actor.hospital.id,
      });
    }
    if (filters.unitId)
      query.andWhere('unit.id = :unitId', { unitId: filters.unitId });
    if (
      filters.status &&
      !['OPEN', 'RESOLVED'].includes(filters.status.toUpperCase())
    )
      throw new BadRequestException('Status must be OPEN or RESOLVED.');
    if (filters.status)
      query.andWhere('event.state = :state', {
        state: filters.status.toUpperCase(),
      });
    if (filters.from) {
      const from = new Date(filters.from);
      if (Number.isNaN(from.getTime()))
        throw new BadRequestException('Invalid from timestamp.');
      query.andWhere('event.at >= :from', { from });
    }
    if (filters.to) {
      const to = new Date(filters.to);
      if (Number.isNaN(to.getTime()))
        throw new BadRequestException('Invalid to timestamp.');
      query.andWhere('event.at <= :to', { to });
    }
    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return ResponseHelper.Success('Cold-chain events retrieved', {
      items: rows.map((event) => ({
        id: event.id,
        unitId: event.unit.id,
        severity: event.severity,
        message: event.message,
        actionTaken: event.action_taken,
        at: event.at,
        lastSeenAt: event.last_seen_at,
        resolvedAt: event.resolved_at,
        status: event.state,
        state: event.state,
        observedMinCelsius: event.observed_min_celsius,
        observedMaxCelsius: event.observed_max_celsius,
      })),
      total,
      page,
      limit,
    });
  }

  stream(
    actorId: string,
    expiresAt: number,
    lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let allowedUnitIds = new Set<string>();
      let networkAdmin = false;
      let previouslyNetworkAdmin = false;
      let cursor = /^\d+$/.test(lastEventId ?? '') ? BigInt(lastEventId!) : 0n;
      const sent = new Set<string>();
      let closed = false;

      const emit = (event: ColdChainStreamEvent) => {
        if (closed || (!networkAdmin && !allowedUnitIds.has(event.unitId)))
          return;
        let seq: bigint;
        try {
          seq = BigInt(event.id);
        } catch {
          return;
        }
        if (seq <= cursor || sent.has(event.id)) return;
        cursor = seq;
        sent.add(event.id);
        if (sent.size > 1000) sent.clear();
        subscriber.next({ id: event.id, type: event.type, data: event.data });
      };

      const loadScope = async () => {
        const actor = await this.actor(actorId);
        networkAdmin = this.isNetworkAdmin(actor);
        if (!networkAdmin) {
          if (!actor.hospital?.id)
            throw new ForbiddenException('Account has no facility scope.');
          const units = await this.units.find({
            where: { facility_id: actor.hospital.id },
          });
          allowedUnitIds = new Set(units.map((unit) => unit.id));
        }
      };

      const replay = async () => {
        await loadScope();
        const query = this.outbox
          .createQueryBuilder('outbox')
          .where('outbox.stream_id::bigint > :cursor', {
            cursor: cursor.toString(),
          })
          .orderBy('outbox.stream_id', 'ASC')
          .take(500);
        // Outbox stores the unit UUID directly, so scope it with a facility subquery.
        if (!networkAdmin) {
          if (!allowedUnitIds.size) return;
          query.andWhere('outbox.unit_id IN (:...unitIds)', {
            unitIds: [...allowedUnitIds],
          });
        }
        const backlog = await query.getMany();
        for (const row of backlog) {
          const payload = row.payload;
          emit({
            id: String(row.stream_id),
            type: row.event_type as ColdChainStreamEvent['type'],
            unitId: row.unit_id,
            facilityId: String(payload.facilityId ?? ''),
            data: payload,
          });
        }
      };

      const live = this.bus.events.subscribe(emit);
      void replay().catch(() =>
        subscriber.error(
          new Error('Unable to load cold-chain stream history.'),
        ),
      );
      const keepalive = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          data: { at: new Date().toISOString() },
        });
      }, 20_000);
      const accessCheck = setInterval(async () => {
        if (Date.now() >= expiresAt) {
          subscriber.complete();
          return;
        }
        try {
          const previous = new Set(allowedUnitIds);
          previouslyNetworkAdmin = networkAdmin;
          await loadScope();
          if (
            (previouslyNetworkAdmin && !networkAdmin) ||
            (!networkAdmin &&
              [...previous].some((id) => !allowedUnitIds.has(id)))
          )
            subscriber.complete();
        } catch {
          subscriber.complete();
        }
      }, 5_000);
      return () => {
        closed = true;
        live.unsubscribe();
        clearInterval(keepalive);
        clearInterval(accessCheck);
      };
    });
  }

  private async actor(id: string) {
    const user = await this.users.findOne({
      where: { id },
      relations: { hospital: true, role: true },
    });
    if (!user || !user.active)
      throw new ForbiddenException('Active user account required.');
    return user;
  }

  private isNetworkAdmin(user: User) {
    const role = user.role?.name?.trim().toLowerCase();
    return [
      'admin',
      'superadmin',
      'network admin',
      'network_admin',
      'network-admin',
    ].includes(role ?? '');
  }
}
