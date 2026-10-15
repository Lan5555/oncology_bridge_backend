import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IotDevice } from './entities/iot-device.entity';
import { IotDeviceUnit } from './entities/iot-device-unit.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { IotReadingsService } from './iot-readings.service';
import { ProvisionIotDeviceDto } from './dto/provision-iot-device.dto';

@Injectable()
export class IotDevicesService {
  constructor(
    @InjectRepository(IotDevice)
    private readonly devices: Repository<IotDevice>,
    @InjectRepository(IotDeviceUnit)
    private readonly assignments: Repository<IotDeviceUnit>,
    @InjectRepository(StorageUnit)
    private readonly units: Repository<StorageUnit>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ingest: IotReadingsService,
  ) {}

  async list(actorId: string) {
    await this.assertAdmin(actorId);
    const rows = await this.devices.find({
      relations: { facility: true, units: { unit: true } },
      order: { created_at: 'DESC' },
    });
    return rows.map((device) => this.safeDevice(device));
  }

  async metrics(actorId: string) {
    await this.assertAdmin(actorId);
    return { success: true, data: this.ingest.metrics() };
  }

  async create(actorId: string, dto: ProvisionIotDeviceDto) {
    await this.assertAdmin(actorId);
    if (!/^[A-Za-z0-9._:-]{3,160}$/.test(dto.deviceId))
      throw new ConflictException('deviceId contains unsupported characters.');
    if (dto.sensorMinCelsius >= dto.sensorMaxCelsius)
      throw new ConflictException(
        'Sensor minimum must be below sensor maximum.',
      );
    if (await this.devices.exists({ where: { device_id: dto.deviceId } }))
      throw new ConflictException('Device ID is already registered.');
    const secretFingerprint = this.ingest.credentialFingerprint(dto.secretRef);
    const [facility, units] = await Promise.all([
      this.hospitals.findOneBy({ id: dto.facilityId }),
      this.units.findBy({ id: In(dto.unitIds) }),
    ]);
    if (!facility) throw new NotFoundException('Facility not found.');
    if (
      units.length !== new Set(dto.unitIds).size ||
      units.some((unit) => unit.facility_id !== facility.id)
    )
      throw new ConflictException(
        'Every assigned storage unit must belong to the selected facility.',
      );

    const device = await this.devices.save(
      this.devices.create({
        device_id: dto.deviceId,
        facility,
        facility_id: facility.id,
        secret_ref: dto.secretRef,
        secret_fingerprint: secretFingerprint,
        active: true,
        expected_interval_seconds: dto.expectedIntervalSeconds,
        sensor_min_celsius: dto.sensorMinCelsius,
        sensor_max_celsius: dto.sensorMaxCelsius,
        revoked_at: null,
      }),
    );
    const assignments = units.map((unit) =>
      this.assignments.create({ device, unit }),
    );
    await this.assignments.save(assignments);
    const offlineSeconds = Math.max(30, dto.expectedIntervalSeconds * 3);
    await this.units.update(
      { id: In(dto.unitIds) },
      {
        offline_after_seconds: offlineSeconds,
      },
    );
    const complete = await this.devices.findOne({
      where: { id: device.id },
      relations: { facility: true, units: { unit: true } },
    });
    return this.safeDevice(complete!);
  }

  async rotate(actorId: string, id: string, secretRef: string) {
    await this.assertAdmin(actorId);
    const device = await this.devices.findOneBy({ id });
    if (!device) throw new NotFoundException('IoT device not found.');
    if (!device.active || device.revoked_at)
      throw new ConflictException('Revoked devices cannot rotate credentials.');
    const fingerprint = this.ingest.credentialFingerprint(secretRef);
    device.secret_ref = secretRef;
    device.secret_fingerprint = fingerprint;
    await this.devices.save(device);
    return { id: device.id, deviceId: device.device_id, rotated: true };
  }

  async revoke(actorId: string, id: string) {
    await this.assertAdmin(actorId);
    const device = await this.devices.findOneBy({ id });
    if (!device) throw new NotFoundException('IoT device not found.');
    device.active = false;
    device.revoked_at = new Date();
    await this.devices.save(device);
    return {
      id: device.id,
      deviceId: device.device_id,
      active: false,
      revokedAt: device.revoked_at,
    };
  }

  private async assertAdmin(id: string) {
    const user = await this.users.findOne({
      where: { id },
      relations: { role: true },
    });
    const role = user?.role?.name.trim().toLowerCase();
    if (
      !user?.active ||
      !['admin', 'superadmin', 'network admin', 'network_admin', 'network-admin'].includes(role ?? '')
    )
      throw new ForbiddenException('Network Admin role required.');
  }

  private safeDevice(device: IotDevice) {
    return {
      id: device.id,
      deviceId: device.device_id,
      facility: { id: device.facility.id, name: device.facility.name },
      active: device.active,
      revokedAt: device.revoked_at,
      expectedIntervalSeconds: device.expected_interval_seconds,
      permittedUnits:
        device.units?.map((assignment) => ({
          id: assignment.unit.id,
          label: assignment.unit.label,
        })) ?? [],
      createdAt: device.created_at,
    };
  }
}
