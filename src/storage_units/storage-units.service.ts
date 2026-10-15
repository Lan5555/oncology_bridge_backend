import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StorageUnit } from './entities/storage-unit.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { TemperatureLog } from '../temperature_log/entities/temperature_log.entity';
import { CreateStorageUnitDto } from './dto/create-storage-unit.dto';
import { UpdateStorageUnitDto } from './dto/update-storage-unit.dto';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class StorageUnitsService {
  constructor(
    @InjectRepository(StorageUnit)
    private readonly units: Repository<StorageUnit>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(TemperatureLog)
    private readonly readings: Repository<TemperatureLog>,
  ) {}

  async all(actorId: string) {
    const actor = await this.actor(actorId);
    const query = this.units
      .createQueryBuilder('unit')
      .orderBy('unit.label', 'ASC');
    if (!this.isNetworkAdmin(actor)) {
      if (!actor.hospital?.id)
        throw new ForbiddenException('Account has no facility scope.');
      query.where('unit.facility_id = :facilityId', {
        facilityId: actor.hospital.id,
      });
    }
    const units = await query.getMany();
    if (!units.length)
      return ResponseHelper.Success('Storage units retrieved', []);
    const ids = units.map((unit) => unit.id);
    const readings = await this.readings.find({
      where: { unit: { id: In(ids) } },
      relations: { unit: true },
      order: { recorded_at: 'DESC' },
    });
    const latest = new Map<string, TemperatureLog>();
    for (const reading of readings) {
      const unitId = reading.unit?.id;
      if (unitId && !latest.has(unitId)) latest.set(unitId, reading);
    }
    const facilityIds = [...new Set(units.map((unit) => unit.facility_id))];
    const facilities = await this.hospitals.findBy({ id: In(facilityIds) });
    const facilityMap = new Map(
      facilities.map((hospital) => [hospital.id, hospital]),
    );
    const now = Date.now();
    return ResponseHelper.Success(
      'Storage units retrieved',
      units.map((unit) => {
        const reading = latest.get(unit.id);
        const lastSeen = unit.last_seen_at?.getTime() ?? 0;
        const offline =
          !lastSeen || now - lastSeen > unit.offline_after_seconds * 1000;
        const temp = reading ? Number(reading.temperature) : null;
        const readingState = offline
          ? 'OFFLINE'
          : temp !== null &&
              (temp < Number(unit.target_min) || temp > Number(unit.target_max))
            ? 'BREACH'
            : 'NOMINAL';
        const facility = facilityMap.get(unit.facility_id);
        return {
          id: unit.id,
          label: unit.label,
          kind: unit.kind,
          facility: facility ? { id: facility.id, name: facility.name } : null,
          targetMin: Number(unit.target_min),
          targetMax: Number(unit.target_max),
          currentC: temp,
          currentReadingAt: reading?.recorded_at ?? null,
          lastSeenAt: unit.last_seen_at,
          readingState,
          offlineAfterSeconds: unit.offline_after_seconds,
        };
      }),
    );
  }

  async create(actorId: string, data: CreateStorageUnitDto) {
    const actor = await this.actor(actorId);
    this.assertNetworkAdmin(actor);
    if (Number(data.target_min) >= Number(data.target_max))
      throw new BadRequestException(
        'Storage-unit minimum must be lower than maximum.',
      );
    const facility = await this.hospitals.findOneBy({ id: data.facility_id });
    if (!facility) throw new NotFoundException('Facility not found.');
    const unit = this.units.create({
      facility_id: data.facility_id,
      label: data.label,
      kind: data.kind,
      target_min: data.target_min,
      target_max: data.target_max,
      offline_after_seconds: data.offline_after_seconds || 900,
      operational_state: 'UNKNOWN',
      last_seen_at: null,
      device_key: null,
    });
    return ResponseHelper.Success(
      'Storage unit created',
      await this.units.save(unit),
    );
  }

  async update(actorId: string, id: string, data: UpdateStorageUnitDto) {
    const actor = await this.actor(actorId);
    this.assertNetworkAdmin(actor);
    const unit = await this.units.findOneBy({ id });
    if (!unit) throw new NotFoundException('Storage unit not found.');
    const {
      facility_id,
      label,
      kind,
      target_min,
      target_max,
      offline_after_seconds,
    } = data;
    if (
      target_min !== undefined &&
      target_max !== undefined &&
      target_min >= target_max
    )
      throw new BadRequestException(
        'Storage-unit minimum must be lower than maximum.',
      );
    if (facility_id) {
      if (!(await this.hospitals.exists({ where: { id: facility_id } })))
        throw new NotFoundException('Facility not found.');
      unit.facility_id = facility_id;
    }
    if (label !== undefined) unit.label = label;
    if (kind !== undefined) unit.kind = kind;
    if (target_min !== undefined) unit.target_min = target_min;
    if (target_max !== undefined) unit.target_max = target_max;
    if (offline_after_seconds !== undefined)
      unit.offline_after_seconds = offline_after_seconds;
    return ResponseHelper.Success(
      'Storage unit updated',
      await this.units.save(unit),
    );
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
    return ['admin', 'superadmin', 'network admin', 'network_admin', 'network-admin'].includes(
      role ?? '',
    );
  }

  private assertNetworkAdmin(user: User) {
    if (!this.isNetworkAdmin(user))
      throw new ForbiddenException('Network Admin role required.');
  }
}
