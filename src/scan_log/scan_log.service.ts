import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ScanLog } from './entities/scan_log.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { CreateScanLogDto } from './dto/create-scan_log.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { UpdateScanLogDto } from './dto/update-scan_log.dto';
import { normalizeGs1Expiry, validateGtin } from './gs1-parser';
import { StockAccessService } from '../guards/stock-access.service';
import { reviewedSellingUnit } from '../inventory/selling-unit';

export interface ScanActor {
  id: string;
}

@Injectable()
export class ScanLogService {
  constructor(
    @InjectRepository(ScanLog) private readonly scans: Repository<ScanLog>,
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    private readonly stockAccess: StockAccessService,
  ) {}

  async create(dto: CreateScanLogDto, actor: ScanActor, ip = 'unknown') {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!dto || !uuidPattern.test(String(dto.facilityId ?? '')))
      throw new BadRequestException('A valid facilityId UUID is required.');
    if (!uuidPattern.test(String(dto.clientUuid ?? '')))
      throw new BadRequestException(
        'A valid clientUuid idempotency key is required.',
      );
    if (!dto.clientTs || Number.isNaN(Date.parse(dto.clientTs)))
      throw new BadRequestException('A valid ISO 8601 clientTs is required.');
    if (!['NEW', 'AVAILABLE', 'NEAR_EXPIRY'].includes(dto.action))
      throw new BadRequestException(
        'action must be NEW, AVAILABLE, or NEAR_EXPIRY.',
      );
    if (
      typeof dto.gtin !== 'string' ||
      typeof dto.lot !== 'string' ||
      typeof dto.serial !== 'string'
    )
      throw new BadRequestException('gtin, lot, and serial must be strings.');
    const quantity = dto.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new BadRequestException(
        'Scan quantity must be a positive integer.',
      );

    const user = await this.stockAccess.assertManage(actor.id, dto.facilityId);
    const sellingUnit = reviewedSellingUnit(dto);

    const existingRequest = await this.scans.findOne({
      where: { client_uuid: dto.clientUuid },
      relations: { scannedBy: true, facility: true },
    });
    if (existingRequest) {
      if (
        existingRequest.scannedBy?.id &&
        existingRequest.scannedBy.id !== user.id
      )
        throw new ConflictException(
          'This idempotency key was already used by another user.',
        );
      if (
        existingRequest.facility?.id &&
        existingRequest.facility.id !== dto.facilityId
      )
        throw new ConflictException(
          'This idempotency key was already used for another facility.',
        );
      return this.scanResponse(existingRequest, true);
    }

    const expiry = normalizeGs1Expiry(dto.expiry);
    if (!validateGtin(dto.gtin))
      throw new BadRequestException('Invalid GS1 GTIN-14 check digit.');
    if (!dto.lot.trim() || !dto.serial.trim() || !expiry)
      throw new BadRequestException(
        'A valid GS1 lot, serial, and expiry are required.',
      );

    const [medicine, hospital] = await Promise.all([
      this.medicines.findOneBy({ gtin: dto.gtin }),
      this.hospitals.findOneBy({ id: dto.facilityId }),
    ]);
    if (!medicine || !hospital)
      throw new NotFoundException('Product or facility not found.');

    const duplicateScan = await this.scans.findOne({
      where: { serial_number: dto.serial.trim() },
      relations: { inventory: true },
    });
    let item: Inventory | null = duplicateScan?.inventory ?? null;
    if (!duplicateScan) {
      item = await this.inventory.findOne({
        where: {
          hospital: { id: hospital.id },
          medicine: { id: medicine.id },
          batch_number: dto.lot.trim(),
          selling_unit: sellingUnit ?? IsNull(),
          expiry_date: new Date(`${expiry}T00:00:00.000Z`),
          status: In(['AVAILABLE', 'NEAR_EXPIRY']),
        },
        relations: { hospital: true, medicine: true },
      });
      if (item) {
        // Increment in SQL so concurrent payment updates cannot be overwritten.
        await this.inventory.increment({ id: item.id }, 'quantity', quantity);
        item.quantity += quantity;
      } else {
        item = this.inventory.create({
          hospital,
          medicine,
          batch_number: dto.lot.trim(),
          serial_number: dto.serial.trim(),
          expiry_date: new Date(`${expiry}T00:00:00.000Z`),
          quantity,
          selling_unit: sellingUnit ?? null,
          status: 'AVAILABLE',
        });
      }
      if (!item.id) item = await this.inventory.save(item);
    }
    if (!item)
      throw new NotFoundException(
        'Inventory record for the duplicate serial was not found.',
      );

    const result = duplicateScan ? 'FLAGGED' : 'CLEAN';
    const saved = await this.scans.save(
      this.scans.create({
        inventory: item,
        scannedBy: user,
        facility: hospital,
        gtin: dto.gtin,
        batch_number: dto.lot.trim(),
        serial_number: dto.serial.trim(),
        expiry_date: new Date(`${expiry}T00:00:00.000Z`),
        client_uuid: dto.clientUuid,
        client_ts: new Date(dto.clientTs),
        action: dto.action,
        notes: dto.notes?.trim() || null,
        result,
      }),
    );

    await this.audits.save(
      this.audits.create({
        user,
        action: 'GS1_SCAN',
        description: JSON.stringify({
          scanId: saved.id,
          facilityId: hospital.id,
          gtin: dto.gtin,
          result,
          clientUuid: dto.clientUuid,
          sellingUnit: item.selling_unit ?? null,
        }),
        ip_address: ip,
      }),
    );
    return this.scanResponse(saved, false);
  }

  async batch(items: CreateScanLogDto[], actor: ScanActor, ip = 'unknown') {
    if (!Array.isArray(items))
      throw new BadRequestException('Batch body must contain a scans array.');
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          return await this.create(item, actor, ip);
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : 'Scan failed',
            data: { clientUuid: item?.clientUuid ?? null },
          };
        }
      }),
    );
    return ResponseHelper.Success('Scan batch processed', { results });
  }

  async findAll(actor: ScanActor) {
    const rows = await this.visibleScans(actor, 200);
    return ResponseHelper.Success(
      'Scans retrieved',
      rows.map((row) => this.toSafeScan(row)),
    );
  }

  async recent(actor: ScanActor, limit = 5) {
    const rows = await this.visibleScans(
      actor,
      Math.max(1, Math.min(100, limit)),
    );
    return ResponseHelper.Success(
      'Recent scans retrieved',
      rows.map((scan) => ({
        id: scan.id,
        gtin: scan.gtin,
        lot: scan.batch_number,
        drug: scan.inventory?.medicine?.generic_name ?? null,
        result: scan.result,
        status: scan.result,
        at: scan.created_at,
        facilityId: scan.inventory?.hospital?.id ?? null,
      })),
    );
  }

  async monthly(actor: ScanActor) {
    const rows = await this.visibleScans(actor, 100_000);
    const totals = new Map<string, number>();
    rows.forEach((row) => {
      const month = new Date(row.created_at).toISOString().slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + 1);
    });
    return ResponseHelper.Success(
      'Monthly scans retrieved',
      [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count })),
    );
  }

  async findOne(id: string, actor: ScanActor) {
    const rows = await this.visibleScans(actor, 1, id);
    const row = rows[0];
    if (!row) throw new NotFoundException('Scan not found.');
    return ResponseHelper.Success('Scan retrieved', this.toSafeScan(row));
  }

  update(_id: string, _dto: UpdateScanLogDto): never {
    throw new ForbiddenException('Scan history cannot be modified.');
  }

  remove(_id: string): never {
    throw new ForbiddenException('Scan history cannot be deleted.');
  }

  private async visibleScans(actor: ScanActor, limit: number, scanId?: string) {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { hospital: true, role: true },
    });
    if (!user || !user.active)
      throw new ForbiddenException('Active user account required.');
    const qb = this.scans
      .createQueryBuilder('scan')
      .leftJoinAndSelect('scan.inventory', 'inventory')
      .leftJoinAndSelect('inventory.medicine', 'medicine')
      .leftJoinAndSelect('inventory.hospital', 'hospital')
      .leftJoinAndSelect('scan.scannedBy', 'scannedBy')
      .leftJoinAndSelect('scan.facility', 'facility')
      .orderBy('scan.created_at', 'DESC')
      .take(limit);
    if (scanId) qb.andWhere('scan.id = :scanId', { scanId });
    if (!this.isNetworkAdmin(user)) {
      if (!user.hospital?.id)
        throw new ForbiddenException(
          'Your account is not assigned to a facility.',
        );
      qb.andWhere(
        '(facility.id = :facilityId OR (facility.id IS NULL AND hospital.id = :facilityId))',
        {
          facilityId: user.hospital.id,
        },
      );
    }
    return qb.getMany();
  }

  async assertCanScan(actor: ScanActor, facilityId: string) {
    await this.stockAccess.assertManage(actor.id, facilityId);
  }

  private isNetworkAdmin(user: User) {
    const role = user.role?.name?.trim().toLowerCase();
    return [
      'admin',
      'superadmin',
      'c',
      'network admin',
      'network_admin',
      'network-admin',
    ].includes(role ?? '');
  }

  private scanResponse(scan: ScanLog, replay: boolean) {
    return ResponseHelper.Success(
      replay ? 'Previously recorded scan returned' : 'GS1 scan recorded',
      {
        id: scan.id,
        result: scan.result,
        duplicate: scan.result === 'FLAGGED',
        gs1Verified: true,
        clientUuid: scan.client_uuid,
        replay,
      },
    );
  }

  private toSafeScan(scan: ScanLog) {
    return {
      id: scan.id,
      gtin: scan.gtin,
      lot: scan.batch_number,
      serial: scan.serial_number,
      expiry: scan.expiry_date,
      result: scan.result,
      action: scan.action,
      notes: scan.notes,
      at: scan.created_at,
      clientUuid: scan.client_uuid,
      facility: scan.facility
        ? { id: scan.facility.id, name: scan.facility.name }
        : scan.inventory?.hospital
          ? {
              id: scan.inventory.hospital.id,
              name: scan.inventory.hospital.name,
            }
          : null,
      medicine: scan.inventory?.medicine
        ? {
            id: scan.inventory.medicine.id,
            name: scan.inventory.medicine.generic_name,
            brand: scan.inventory.medicine.brand_name,
          }
        : null,
      scannedBy: scan.scannedBy ? { id: scan.scannedBy.id } : null,
    };
  }
}
