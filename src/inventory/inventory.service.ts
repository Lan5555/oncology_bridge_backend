import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
  ) {}

  async create(dto: CreateInventoryDto, authenticatedFacilityId?: string) {
    const requestedHospitalId = dto.facilityId ?? dto.hospitalId;
    if (
      authenticatedFacilityId !== undefined &&
      requestedHospitalId &&
      requestedHospitalId !== authenticatedFacilityId
    )
      throw new BadRequestException(
        'Inventory can only be created for your authenticated facility',
      );
    const hospitalId =
      authenticatedFacilityId !== undefined
        ? authenticatedFacilityId
        : requestedHospitalId;
    const medicineId = dto.drugId ?? dto.medicineId;
    const batchNumber = dto.batchNumber ?? dto.batch_number;
    const expiryDate = dto.expiry ?? dto.expiry_date;
    if (
      !hospitalId ||
      !batchNumber ||
      !expiryDate ||
      !Number.isInteger(Number(dto.quantity)) ||
      Number(dto.quantity) < 1
    ) {
      throw new BadRequestException(
        'facilityId, drug or drugId, batchNumber, expiry and positive quantity are required',
      );
    }
    const [hospital, medicine] = await Promise.all([
      this.hospitals.findOneBy({ id: hospitalId }),
      medicineId
        ? this.medicines.findOneBy({ id: medicineId })
        : this.medicines
            .createQueryBuilder('m')
            .where(
              'm.generic_name ILIKE :drug OR m.brand_name ILIKE :drug OR m.gtin = :exact',
              { drug: dto.drug, exact: dto.drug },
            )
            .getOne(),
    ]);
    if (!hospital || !medicine)
      throw new NotFoundException('Facility or medicine not found');
    const item = this.inventory.create({
      hospital,
      medicine,
      batch_number: batchNumber,
      serial_number: dto.serial_number ?? '',
      expiry_date: new Date(expiryDate),
      quantity: dto.quantity,
      selling_unit: dto.sellingUnit ?? null,
      status: dto.status ?? 'AVAILABLE',
    });
    return ResponseHelper.Success(
      'Inventory item created',
      await this.inventory.save(item),
    );
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
    const statsQb = this.inventory.createQueryBuilder('i');
    if (options.authenticatedFacilityId !== undefined)
      statsQb.andWhere('i.hospital_id = :facilityId', {
        facilityId: options.authenticatedFacilityId,
      });
    const [all, quarantined] = await Promise.all([
      statsQb.getMany(),
      this.inventory
        .createQueryBuilder('i')
        .where("i.status = 'QUARANTINED'")
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
        lot: i.batch_number,
        serial: i.serial_number,
        facility: i.hospital?.name,
        facilityId: i.hospital?.id,
        qty: i.quantity,
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
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return ResponseHelper.Success('Inventory item retrieved', item);
  }

  async update(
    id: string,
    dto: UpdateInventoryDto,
    authenticatedFacilityId?: string,
  ) {
    return this.inventory.manager.transaction(async (manager) => {
      const inventory = manager.getRepository(Inventory);
      const item = await inventory
        .createQueryBuilder('item')
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
        ...fields
      } = dto;
      Object.assign(item, fields);
      if (sellingUnit !== undefined) item.selling_unit = sellingUnit;
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
      return ResponseHelper.Success(
        'Inventory item updated',
        await inventory.save(item),
      );
    });
  }

  async setStatus(
    id: string,
    status: string,
    authenticatedFacilityId?: string,
  ) {
    const item = await this.inventory.findOne({
      where: { id },
      relations: { hospital: true },
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
      item,
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
    const until = new Date(now);
    until.setDate(until.getDate() + Math.max(1, withinDays));
    const rows = await this.inventory
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.medicine', 'medicine')
      .leftJoinAndSelect('i.hospital', 'hospital')
      .where('i.expiry_date BETWEEN :now AND :until', { now, until })
      .andWhere(
        authenticatedFacilityId !== undefined
          ? 'hospital.id = :facilityId'
          : '1=1',
        { facilityId: authenticatedFacilityId },
      )
      .andWhere("UPPER(i.status) NOT IN ('QUARANTINED','DISPOSED')")
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
      total: items.length,
      items,
    });
  }
}
