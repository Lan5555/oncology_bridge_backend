import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAccessService } from '../guards/stock-access.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from './entities/medicine.entity';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { DataSource } from 'typeorm';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { validateGtin } from '../scan_log/gs1-parser';

@Injectable()
export class MedicineService {
  constructor(
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
    private readonly dataSource: DataSource,
    private readonly stockAccess: StockAccessService,
  ) {}
  async create(dto: CreateMedicineDto, actorId: string) {
    const actor = await this.stockAccess.catalogueActor(
      actorId,
      'medicine.create',
    );
    return ResponseHelper.Success(
      'Medicine created',
      await this.medicines.save(
        this.medicines.create({
          ...dto,
          catalog_facility_id: actor.facilityId,
        }),
      ),
    );
  }
  async findAll(q?: string) {
    const qb = this.medicines
      .createQueryBuilder('m')
      .orderBy('m.generic_name', 'ASC');
    if (q)
      qb.where(
        '(m.generic_name ILIKE :q OR m.brand_name ILIKE :q OR m.gtin ILIKE :q)',
        { q: `%${q}%` },
      );
    return ResponseHelper.Success('Medicines retrieved', await qb.getMany());
  }
  async findOne(id: string) {
    const row = await this.medicines.findOne({
      where: { id },
      relations: { inventory: true },
    });
    if (!row) throw new NotFoundException('Medicine not found');
    return ResponseHelper.Success('Medicine retrieved', row);
  }
  async findByGtin(gtin: string) {
    const row = await this.medicines.findOneBy({ gtin });
    return ResponseHelper.Success(
      row ? 'GS1 product found' : 'GS1 product not found',
      row
        ? {
            gtin: row.gtin,
            drug: row.generic_name,
            brand: row.brand_name,
            strength: row.strength,
            manufacturer: row.manufacturer,
          }
        : null,
    );
  }
  async update(
    id: string,
    dto: {
      generic_name?: string;
      brand?: string;
      strength?: string;
      gtin?: string;
    },
    actorId: string,
    ip: string,
  ) {
    if (!Object.keys(dto).length)
      throw new BadRequestException(
        'At least one medicine field must be provided',
      );
    if (dto.gtin !== undefined && !validateGtin(dto.gtin))
      throw new BadRequestException('gtin must be a valid GTIN-14');
    for (const [field, value] of Object.entries(dto)) {
      if (typeof value === 'string' && !value.trim())
        throw new BadRequestException(`${field} must not be blank`);
    }
    return this.dataSource.transaction(async (manager) => {
      const medicines = manager.getRepository(Medicine);
      const actor = await this.stockAccess.catalogueActor(
        actorId,
        'medicine.update',
        manager,
      );
      const row = await medicines.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Medicine not found');
      if (
        actor.facilityId !== null &&
        row.catalog_facility_id !== actor.facilityId
      )
        throw new ForbiddenException(
          'You may only edit catalogue records owned by your facility. Shared records require network administration.',
        );
      await this.assertNoForeignStock(manager, id, actor.facilityId);
      if (dto.generic_name !== undefined)
        row.generic_name = dto.generic_name.trim();
      if (dto.brand !== undefined) row.brand_name = dto.brand.trim();
      if (dto.strength !== undefined) row.strength = dto.strength.trim();
      if (dto.gtin !== undefined) row.gtin = dto.gtin;
      const saved = await medicines.save(row);
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'MEDICINE_UPDATED',
        description: `Medicine ${id} updated; fields: ${Object.keys(dto).join(', ')}`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'medicine',
        object_id: id,
        request_id: null,
        before_status: null,
        after_status: 'ACTIVE',
      });
      return ResponseHelper.Success('Medicine updated', {
        ...saved,
        brand: saved.brand_name,
      });
    });
  }
  async remove(id: string, actorId: string, ip: string) {
    return this.dataSource.transaction(async (manager) => {
      const medicines = manager.getRepository(Medicine);
      const actor = await this.stockAccess.catalogueActor(
        actorId,
        'medicine.delete',
        manager,
      );
      const row = await medicines.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Medicine not found');
      if (
        actor.facilityId !== null &&
        row.catalog_facility_id !== actor.facilityId
      )
        throw new ForbiddenException(
          'You may only delete catalogue records owned by your facility. Shared records require network administration.',
        );
      await this.assertNoForeignStock(manager, id, actor.facilityId);
      await medicines.softDelete({ id });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'MEDICINE_REMOVED',
        description: `Medicine ${id} removed from active catalog using soft delete`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'medicine',
        object_id: id,
        request_id: null,
        before_status: 'ACTIVE',
        after_status: 'REMOVED',
      });
      return ResponseHelper.Success('Medicine removed from active use', {
        id,
        status: 'REMOVED',
      });
    });
  }

  private async assertNoForeignStock(
    manager: EntityManager,
    medicineId: string,
    facilityId: string | null,
  ) {
    if (facilityId === null) return;
    if (
      await manager.getRepository(Inventory).exists({
        where: {
          medicine: { id: medicineId },
          hospital: { id: Not(facilityId) },
        },
      })
    )
      throw new ForbiddenException(
        'This catalogue record is used by other facilities and requires network administration to change.',
      );
  }
}
