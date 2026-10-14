import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Medicine } from './entities/medicine.entity';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class MedicineService {
  constructor(
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
  ) {}
  async create(dto: CreateMedicineDto) {
    return ResponseHelper.Success(
      'Medicine created',
      await this.medicines.save(this.medicines.create(dto)),
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
  async update(id: string, dto: UpdateMedicineDto) {
    const row = await this.medicines.findOneBy({ id });
    if (!row) throw new NotFoundException('Medicine not found');
    Object.assign(row, dto);
    return ResponseHelper.Success(
      'Medicine updated',
      await this.medicines.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.medicines.findOne({
      where: { id },
      relations: { inventory: true },
    });
    if (!row) throw new NotFoundException('Medicine not found');
    if (row.inventory?.length)
      return ResponseHelper.Error(
        'Medicine is referenced by inventory and cannot be deleted',
        null,
      );
    await this.medicines.remove(row);
    return ResponseHelper.Success('Medicine deleted', null);
  }
}
