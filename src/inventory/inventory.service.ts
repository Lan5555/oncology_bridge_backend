/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { activeInventory } from './active-inventory';
import { listingExists } from '../marketplace/listing-exists';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { ManualInventoryIntakeDto } from './dto/manual-inventory-intake.dto';
import { StockAccessService } from '../guards/stock-access.service';
import { catalogueMedicineScope } from '../operations/operational-resources';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { reviewedSellingUnit } from './selling-unit';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
    private readonly stockAccess: StockAccessService,
  ) {}

  async create(dto: ManualInventoryIntakeDto, actorId: string, ip = 'unknown') {
    const unit = reviewedSellingUnit(dto, true)!;
    if (
      !dto.medicineId ||
      !dto.batchNumber?.trim() ||
      dto.batchNumber.trim().length > 200 ||
      !Number.isInteger(dto.quantity) ||
      dto.quantity < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dto.expiry ?? '') ||
      Number.isNaN(Date.parse(dto.expiry)) ||
      new Date(dto.expiry).toISOString().slice(0, 10) !== dto.expiry
    )
      throw new BadRequestException(
        'medicineId, nonblank batchNumber, valid YYYY-MM-DD expiry and positive integer quantity are required',
      );
    return this.inventory.manager.transaction(async (manager) => {
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const facilityId = actor.hospital.id;
      for (const requested of [dto.facilityId, dto.hospitalId])
        if (requested !== undefined && requested !== facilityId)
          throw new ForbiddenException(
            'Inventory can only be created for your authenticated facility',
          );
      // Serialize concurrent manual submissions per facility without modifying history.
      await manager.getRepository(Hospital).findOne({
        where: { id: facilityId },
        lock: { mode: 'pessimistic_write' },
      });
      const medicine = await manager
        .getRepository(Medicine)
        .createQueryBuilder('m')
        .where('m.id = :medicineId', { medicineId: dto.medicineId })
        .andWhere('m.deleted_at IS NULL')
        .andWhere(catalogueMedicineScope(':facilityId'), { facilityId })
        .setLock('pessimistic_read')
        .getOne();
      if (!medicine)
        throw new NotFoundException(
          'Medicine not found, inactive, or unavailable in your facility catalogue',
        );
      const inventory = manager.getRepository(Inventory);
      const batch = dto.batchNumber.trim();
      if (
        await inventory.exists({
          where: {
            hospital: { id: facilityId },
            medicine: { id: medicine.id },
            batch_number: batch,
          },
        })
      )
        throw new ConflictException(
          'This medicine batch already exists at your facility. No stock was added; review the existing batch.',
        );
      const saved = await inventory.save(
        inventory.create({
          hospital: actor.hospital,
          medicine,
          batch_number: batch,
          serial_number: dto.serial_number ?? '',
          expiry_date: new Date(dto.expiry),
          quantity: dto.quantity,
          selling_unit: unit,
          status: 'AVAILABLE',
        }),
      );
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'INVENTORY_CREATED',
        description: JSON.stringify({
          actorId,
          facilityId,
          medicineId: medicine.id,
          inventoryId: saved.id,
          batchNumber: batch,
          unit,
          quantity: saved.quantity,
          unitReviewedBy: actorId,
        }),
        ip_address: ip || 'unknown',
        object_type: 'inventory',
        object_id: saved.id,
        event_key: null,
        request_id: null,
        before_status: null,
        after_status: 'AVAILABLE',
      });
      return ResponseHelper.Success('Inventory item created', {
        ...saved,
        medicine: {
          id: medicine.id,
          generic_name: medicine.generic_name,
          brand_name: medicine.brand_name,
          gtin: medicine.gtin,
          storage_temperature: medicine.storage_temperature,
        },
        medicine_id: medicine.id,
        drug: medicine.generic_name,
        gtin: medicine.gtin,
        batchNumber: batch,
        lot: batch,
        qty: saved.quantity,
        unit: saved.selling_unit,
        expiry: dto.expiry,
        facilityId,
        facility: actor.hospital.name,
        linkageStatus: 'LINKED',
      });
    });
  }

  async findAll(
    options: {
      category?: string;
      facilityId?: string;
      authenticatedFacilityId?: string;
      q?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const qb = this.inventory
      .createQueryBuilder('i')
      .andWhere(activeInventory())
      .leftJoinAndSelect('i.medicine', 'medicine')
      .leftJoinAndSelect('i.hospital', 'hospital');
    if (options.authenticatedFacilityId !== undefined)
      qb.andWhere('hospital.id = :authenticatedFacilityId', {
        authenticatedFacilityId: options.authenticatedFacilityId,
      });
    else if (options.facilityId)
      qb.andWhere('hospital.id = :facilityId', {
        facilityId: options.facilityId,
      });
    if (options.q)
      qb.andWhere(
        '(medicine.generic_name ILIKE :q OR medicine.brand_name ILIKE :q OR i.batch_number ILIKE :q OR medicine.gtin ILIKE :q)',
        { q: `%${options.q}%` },
      );
    const now = new Date();
    const nearDate = new Date(now);
    nearDate.setDate(now.getDate() + 60);
    if (options.category === 'expiry')
      qb.andWhere('i.expiry_date <= :nearDate AND i.expiry_date >= :now', {
        nearDate,
        now,
      });
    if (options.category === 'quarantine')
      qb.andWhere("UPPER(i.status) = 'QUARANTINED'");
    if (options.category === 'redistributed')
      qb.andWhere("UPPER(i.status) = 'REDISTRIBUTED'");
    const [items, total] = await qb
      .orderBy('i.expiry_date', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const statsQb = this.inventory
      .createQueryBuilder('i')
      .andWhere(activeInventory());
    if (options.authenticatedFacilityId !== undefined)
      statsQb.andWhere('i.hospital_id = :facilityId', {
        facilityId: options.authenticatedFacilityId,
      });
    const [all, quarantined] = await Promise.all([
      statsQb.getMany(),
      this.inventory
        .createQueryBuilder('i')
        .where("i.status = 'QUARANTINED'")
        .andWhere(activeInventory())
        .andWhere(
          options.authenticatedFacilityId !== undefined
            ? 'i.hospital_id = :facilityId'
            : '1=1',
          { facilityId: options.authenticatedFacilityId },
        )
        .getCount(),
    ]);
    const expiryCount = all.filter(
      (i) =>
        new Date(i.expiry_date).getTime() <= nearDate.getTime() &&
        new Date(i.expiry_date).getTime() >= now.getTime(),
    ).length;
    return ResponseHelper.Success('Inventory retrieved', {
      items: items.map((i) => ({
        id: i.id,
        drug: i.medicine?.generic_name,
        brand: i.medicine?.brand_name,
        gtin: i.medicine?.gtin,
        medicine: i.medicine
          ? {
              id: i.medicine.id,
              generic_name: i.medicine.generic_name,
              brand_name: i.medicine.brand_name,
              gtin: i.medicine.gtin,
              storage_temperature: i.medicine.storage_temperature,
            }
          : null,
        lot: i.batch_number,
        serial: i.serial_number,
        facility: i.hospital?.name,
        facilityId: i.hospital?.id,
        qty: i.quantity,
        quantity: i.quantity,
        unit: i.selling_unit,
        expiry: i.expiry_date,
        tempC: null,
        gs1Verified: false,
        status: i.status,
        category:
          i.status.toUpperCase() === 'QUARANTINED'
            ? 'quarantine'
            : i.status.toUpperCase() === 'REDISTRIBUTED'
              ? 'redistributed'
              : new Date(i.expiry_date) <= nearDate
                ? 'expiry'
                : 'all',
      })),
      stats: {
        totalVials: all.reduce((sum, i) => sum + Number(i.quantity), 0),
        gs1VerifiedPct: 0,
        nearExpiry: expiryCount,
        quarantined,
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }

  async findOne(id: string, authenticatedFacilityId?: string) {
    const item = await this.inventory.findOne({
      where: {
        id,
        ...(authenticatedFacilityId !== undefined
          ? { hospital: { id: authenticatedFacilityId } }
          : {}),
      },
      relations: { hospital: true, medicine: true },
      withDeleted: true,
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return ResponseHelper.Success('Inventory item retrieved', {
      ...item,
      medicine: item.medicine
        ? { ...item.medicine, active: !item.medicine.deleted_at }
        : null,
      medicine_deleted: Boolean(item.medicine?.deleted_at),
      medicine_active: Boolean(item.medicine && !item.medicine.deleted_at),
      unit: item.selling_unit,
    });
  }

  async update(
    id: string,
    dto: UpdateInventoryDto,
    authenticatedFacilityId?: string,
    actorId?: string,
    ip = 'unknown',
  ) {
    const reviewedUnit = reviewedSellingUnit(dto);
    return this.inventory.manager.transaction(async (manager) => {
      if (reviewedUnit !== undefined) {
        if (!actorId)
          throw new ForbiddenException(
            'An authorized staff member must review the selling unit',
          );
        const actor = await this.stockAccess.assertManage(
          actorId,
          authenticatedFacilityId,
          undefined,
          manager,
        );
        authenticatedFacilityId = actor.hospital.id;
      }
      const inventory = manager.getRepository(Inventory);
      const item = await inventory
        .createQueryBuilder('item')
        .withDeleted()
        .leftJoinAndSelect('item.medicine', 'medicine')
        .leftJoinAndSelect('item.hospital', 'hospital')
        .where('item.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['item'])
        .getOne();
      if (!item) throw new NotFoundException('Inventory item not found');
      if (
        authenticatedFacilityId !== undefined &&
        item.hospital?.id !== authenticatedFacilityId
      )
        throw new NotFoundException('Inventory item not found');
      const {
        hospitalId,
        facilityId,
        medicineId,
        drugId,
        drug,
        expiry_date,
        expiry,
        batch_number,
        batchNumber,
        sellingUnit,
        unit,
        ...fields
      } = dto;
      Object.assign(item, fields);
      const previousUnit = item.selling_unit;
      if (reviewedUnit !== undefined && reviewedUnit !== previousUnit) {
        if (await listingExists(manager, id))
          throw new ConflictException(
            'The selling unit of a listed batch cannot be changed',
          );
      }
      if (reviewedUnit !== undefined) item.selling_unit = reviewedUnit;
      if (batch_number ?? batchNumber)
        item.batch_number = batchNumber ?? batch_number!;
      if (expiry_date ?? expiry)
        item.expiry_date = new Date(expiry ?? expiry_date!);
      const selectedHospital = facilityId ?? hospitalId;
      if (
        authenticatedFacilityId !== undefined &&
        selectedHospital &&
        selectedHospital !== authenticatedFacilityId
      )
        throw new BadRequestException(
          'Inventory cannot be moved outside your authenticated facility',
        );
      if (selectedHospital) {
        const h = await this.hospitals.findOneBy({ id: selectedHospital });
        if (!h) throw new NotFoundException('Facility not found');
        item.hospital = h;
      }
      const selectedMedicine = drugId ?? medicineId;
      if (selectedMedicine || drug) {
        const m = selectedMedicine
          ? await this.medicines.findOneBy({ id: selectedMedicine })
          : await this.medicines
              .createQueryBuilder('m')
              .where(
                'm.generic_name ILIKE :drug OR m.brand_name ILIKE :drug OR m.gtin = :exact',
                { drug, exact: drug },
              )
              .getOne();
        if (!m) throw new NotFoundException('Medicine not found');
        item.medicine = m;
      }
      const saved = await inventory.save(item);
      if (reviewedUnit !== undefined)
        await manager.getRepository(AuditLog).save({
          user: { id: actorId! } as User,
          action: 'INVENTORY_UNIT_REVIEWED',
          description: JSON.stringify({
            actorId,
            facilityId: item.hospital.id,
            inventoryId: id,
            batchNumber: item.batch_number,
            previousUnit,
            unit: reviewedUnit,
            quantity: saved.quantity,
          }),
          ip_address: ip || 'unknown',
          object_type: 'inventory',
          object_id: id,
          event_key: null,
          request_id: null,
          before_status: null,
          after_status: saved.status,
        });
      return ResponseHelper.Success('Inventory item updated', {
        ...saved,
        medicine: saved.medicine
          ? { ...saved.medicine, active: !saved.medicine.deleted_at }
          : null,
        medicine_deleted: Boolean(saved.medicine?.deleted_at),
        medicine_active: Boolean(saved.medicine && !saved.medicine.deleted_at),
        unit: saved.selling_unit,
      });
    });
  }

  async setStatus(
    id: string,
    status: string,
    authenticatedFacilityId?: string,
  ) {
    const item = await this.inventory.findOne({
      where: { id },
      relations: { hospital: true, medicine: true },
      withDeleted: true,
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (
      authenticatedFacilityId !== undefined &&
      item.hospital?.id !== authenticatedFacilityId
    )
      throw new NotFoundException('Inventory item not found');
    await this.inventory.update({ id }, { status });
    item.status = status;
    return ResponseHelper.Success(
      `Inventory item marked ${status.toLowerCase()}`,
      {
        ...item,
        medicine: item.medicine
          ? { ...item.medicine, active: !item.medicine.deleted_at }
          : null,
        medicine_deleted: Boolean(item.medicine?.deleted_at),
        medicine_active: Boolean(item.medicine && !item.medicine.deleted_at),
        unit: item.selling_unit,
      },
    );
  }

  async remove(id: string, authenticatedFacilityId?: string) {
    const result = await this.inventory.delete({
      id,
      ...(authenticatedFacilityId !== undefined
        ? { hospital: { id: authenticatedFacilityId } }
        : {}),
    });
    if (!result.affected)
      throw new NotFoundException('Inventory item not found');
    return ResponseHelper.Success('Inventory item removed', null);
  }

  async exportCsv(authenticatedFacilityId?: string) {
    const { data } = await this.findAll({
      limit: 100,
      authenticatedFacilityId,
    });
    const rows = (data as any).items as any[];
    const escape = (value: unknown) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'id,drug,gtin,lot,facility,qty,expiry,status',
      ...rows.map((r) =>
        [r.id, r.drug, r.gtin, r.lot, r.facility, r.qty, r.expiry, r.status]
          .map(escape)
          .join(','),
      ),
    ].join('\n');
    return ResponseHelper.Success('Inventory CSV generated', { csv });
  }

  async stockSearch(q = '', location = '', authenticatedFacilityId?: string) {
    const qb = this.inventory
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.medicine', 'medicine')
      .leftJoinAndSelect('i.hospital', 'hospital');
    if (authenticatedFacilityId !== undefined)
      qb.andWhere('hospital.id = :facilityId', {
        facilityId: authenticatedFacilityId,
      });
    if (q)
      qb.andWhere(
        '(medicine.generic_name ILIKE :q OR medicine.brand_name ILIKE :q OR medicine.gtin ILIKE :q)',
        { q: `%${q}%` },
      );
    if (location)
      qb.andWhere(
        '(hospital.city ILIKE :location OR hospital.state ILIKE :location OR hospital.name ILIKE :location)',
        { location: `%${location}%` },
      );
    const rows = await qb
      .andWhere(activeInventory())
      .andWhere('i.quantity > 0')
      .andWhere("UPPER(i.status) NOT IN ('QUARANTINED','DISPOSED')")
      .orderBy('i.expiry_date', 'ASC')
      .take(100)
      .getMany();
    return ResponseHelper.Success(
      'Stock search retrieved',
      rows.map((i) => ({
        id: i.id,
        drug: i.medicine.generic_name,
        brand: i.medicine.brand_name,
        location: `${i.hospital.city}, ${i.hospital.state}`,
        availableQuantity: i.quantity,
        unit: i.selling_unit,
        unitPriceNaira: null,
        batchNumber: i.batch_number,
        expiresOn: i.expiry_date,
        status: i.status,
      })),
    );
  }

  async findExpiry(
    withinDays = 60,
    limit = 500,
    authenticatedFacilityId?: string,
  ) {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const until = new Date(now);
    until.setDate(until.getDate() + Math.max(1, withinDays));
    const rows = await this.inventory
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.medicine', 'medicine')
      .leftJoinAndSelect('i.hospital', 'hospital')
      .where('i.expiry_date BETWEEN :now AND :until', { now, until })
      .andWhere(activeInventory())
      .andWhere(
        authenticatedFacilityId !== undefined
          ? 'hospital.id = :facilityId'
          : '1=1',
        { facilityId: authenticatedFacilityId },
      )
      .andWhere("UPPER(i.status) IN ('AVAILABLE','NEAR_EXPIRY')")
      .andWhere('i.quantity > 0')
      .andWhere("hospital.status = 'ACTIVE' AND hospital.deleted_at IS NULL")
      .orderBy('i.expiry_date', 'ASC')
      .take(Math.min(500, Math.max(1, limit)))
      .getMany();
    const items = rows.map((i) => ({
      id: i.id,
      drug: i.medicine.generic_name,
      lot: i.batch_number,
      donorFacility: i.hospital.name,
      facilityId: i.hospital.id,
      qty: i.quantity,
      unit: i.selling_unit,
      expiry: i.expiry_date,
      daysLeft: Math.ceil(
        (new Date(i.expiry_date).getTime() - now.getTime()) / 86400000,
      ),
      urgency:
        Math.ceil(
          (new Date(i.expiry_date).getTime() - now.getTime()) / 86400000,
        ) <= 30
          ? 'Critical'
          : 'Warning',
      nearestRecipient: null,
      distanceKm: null,
    }));
    return ResponseHelper.Success('Expiry watchlist retrieved', {
      asOf: new Date().toISOString(),
      total: items.length,
      items,
    });
  }
}
