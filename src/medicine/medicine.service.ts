import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAccessService } from '../guards/stock-access.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from './entities/medicine.entity';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { BulkCreateMedicinesDto } from './dto/bulk-create-medicines.dto';
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
  async createBulk(dto: BulkCreateMedicinesDto, actorId: string) {
    const rows = dto.medicines;
    const errors: { index: number; field: string; message: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== 'string' || !value.trim())
          errors.push({ index, field, message: `${field} must not be blank` });
      }
      if (!validateGtin(row.gtin))
        errors.push({
          index,
          field: 'gtin',
          message: 'gtin must be a valid GTIN-14 with a correct check digit',
        });
      if (seen.has(row.gtin))
        errors.push({
          index,
          field: 'gtin',
          message: 'Duplicate GTIN in this request',
        });
      seen.add(row.gtin);
    });
    if (errors.length)
      throw new BadRequestException({
        message: 'Bulk medicine validation failed',
        data: { errors },
      });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await this.stockAccess.catalogueActor(
          actorId,
          'medicine.create',
          manager,
        );
        const medicines = manager.getRepository(Medicine);
        // Deleted catalogue entries still reserve their unique GTIN.
        const existing = await medicines.find({
          select: { gtin: true },
          where: { gtin: In([...seen]) },
          withDeleted: true,
        });
        if (existing.length) {
          const conflicts = new Set(existing.map((row) => row.gtin));
          throw new ConflictException({
            message:
              'One or more GTINs already exist; no medicines were created',
            data: {
              errors: rows.flatMap((row, index) =>
                conflicts.has(row.gtin)
                  ? [{ index, field: 'gtin', message: 'GTIN already exists' }]
                  : [],
              ),
            },
          });
        }
        const created = await medicines.save(
          rows.map((row) =>
            medicines.create({
              ...row,
              catalog_facility_id: actor.facilityId,
            }),
          ),
        );
        return ResponseHelper.Success('Medicines created', {
          count: created.length,
          medicines: created,
        });
      });
    } catch (error) {
      // A concurrent insert may win after the preflight duplicate check.
      const pgError = error as {
        code?: string;
        driverError?: { code?: string };
      };
      if ((pgError?.driverError?.code ?? pgError?.code) === '23505')
        throw new ConflictException(
          'A GTIN was created concurrently; no medicines were created. Refresh the catalogue and retry.',
        );
      throw error;
    }
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
      // Same lock order as marketplace checkout/payment: serialize before rows.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('oncology-marketplace-stock'))",
      );
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
      const batches = await manager
        .createQueryBuilder()
        .select('batch.id', 'id')
        .addSelect('batch.hospital_id', 'hospital_id')
        .from('inventory', 'batch')
        .where('batch.medicine_id = :medicineId', { medicineId: id })
        .getRawMany<{ id: string; hospital_id: string }>();
      const listings = await manager.query<{ id: string }[]>(
        `UPDATE marketplace_listings SET status='SUSPENDED'
        WHERE inventory_item_id IN (SELECT id FROM inventory WHERE medicine_id=$1)
        AND status<>'SUSPENDED' RETURNING id`,
        [id],
      );
      const reservations = await manager.query<{ id: string }[]>(
        `UPDATE marketplace_orders SET reservation_state='RELEASED'
        WHERE inventory_item_id IN (SELECT id FROM inventory WHERE medicine_id=$1)
        AND reservation_state='RESERVED' RETURNING id`,
        [id],
      );
      const paidOrders = await manager.query<{ id: string }[]>(
        `UPDATE marketplace_orders SET fulfillment_state='PAYMENT_REVIEW_REQUIRED'
        WHERE inventory_item_id IN (SELECT id FROM inventory WHERE medicine_id=$1)
        AND payment_status IN ('PAID','PAID_REVIEW')
        AND fulfillment_state='AWAITING_CLINICAL_RELEASE' RETURNING id`,
        [id],
      );
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'MEDICINE_REMOVED',
        description: JSON.stringify({
          medicineId: id,
          actorId,
          batches,
          suspendedListingIds: listings.map((r: { id: string }) => r.id),
          releasedReservationIds: reservations.map((r: { id: string }) => r.id),
          paidOrderReviewIds: paidOrders.map((r: { id: string }) => r.id),
          physicalStockUnchanged: true,
        }),
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
        medicine_active: false,
        affected: {
          batches: batches.length,
          listings: listings.length,
          reservations: reservations.length,
          paidOrdersForReview: paidOrders.length,
        },
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
