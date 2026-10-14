import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseHelper } from '../helpers/response-helper';
import { User } from '../users/entities/user.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { TemperatureLog } from './entities/temperature_log.entity';

@Injectable()
export class TemperatureLogService {
  constructor(
    @InjectRepository(TemperatureLog)
    private readonly readings: Repository<TemperatureLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(StorageUnit)
    private readonly storageUnits: Repository<StorageUnit>,
  ) {}

  async coldChainHistory(actorId: string, hours = 24, unitId?: string) {
    const actor = await this.users.findOne({
      where: { id: actorId },
      relations: { hospital: true, role: true },
    });
    if (!actor?.active)
      throw new ForbiddenException('Active user account required.');

    const role = actor.role?.name?.trim().toLowerCase();
    const networkAdmin = [
      'network admin',
      'network_admin',
      'network-admin',
    ].includes(role ?? '');
    const unitQuery = this.storageUnits.createQueryBuilder('unit');
    if (!networkAdmin) {
      if (!actor.hospital?.id)
        throw new ForbiddenException('Account has no facility scope.');
      unitQuery.where('unit.facility_id = :facilityId', {
        facilityId: actor.hospital.id,
      });
    }
    if (unitId) unitQuery.andWhere('unit.id = :unitId', { unitId });
    const units = await unitQuery.getMany();
    if (unitId && !units.length)
      throw new NotFoundException(
        'Storage unit not found in your facility scope.',
      );

    const unitIds = units.map((unit) => unit.id);
    if (!unitIds.length)
      return ResponseHelper.Success('Cold-chain history retrieved', {
        readings: [],
        labels: [],
        series: [],
      });

    const since = new Date(
      Date.now() - Math.max(1, Math.min(720, hours)) * 60 * 60 * 1000,
    );
    const rows = await this.readings
      .createQueryBuilder('reading')
      .innerJoinAndSelect('reading.unit', 'unit')
      .where('unit.id IN (:...unitIds)', { unitIds })
      .andWhere('reading.recorded_at >= :since', { since })
      .orderBy('reading.recorded_at', 'ASC')
      .take(10_000)
      .getMany();

    const readings = rows.map((row) => ({
      unitId: row.unit!.id,
      unitLabel: row.unit!.label,
      celsius: Number(row.temperature),
      recordedAt: row.recorded_at.toISOString(),
    }));
    const timestamps = [...new Set(readings.map((row) => row.recordedAt))];
    const labels = timestamps.map((timestamp) => timestamp.slice(11, 16));
    const byUnit = new Map<string, Map<string, number>>();
    for (const reading of readings) {
      if (!byUnit.has(reading.unitId)) byUnit.set(reading.unitId, new Map());
      byUnit.get(reading.unitId)!.set(reading.recordedAt, reading.celsius);
    }
    const unitLabels = new Map(units.map((unit) => [unit.id, unit.label]));
    const series = [...byUnit.entries()].map(([id, values]) => ({
      unitId: id,
      label: unitLabels.get(id) ?? id,
      data: timestamps.map((timestamp) => values.get(timestamp) ?? null),
    }));
    return ResponseHelper.Success('Cold-chain history retrieved', {
      readings,
      labels,
      series,
    });
  }
}
