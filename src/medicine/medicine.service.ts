import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  async update(id: string, dto: { generic_name?: string; brand?: string; strength?: string; gtin?: string }, actorId: string, ip: string) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one medicine field must be provided');
    if (dto.gtin !== undefined && !validateGtin(dto.gtin))
      throw new BadRequestException('gtin must be a valid GTIN-14');
    for (const [field, value] of Object.entries(dto)) {
      if (typeof value === 'string' && !value.trim())
        throw new BadRequestException(`${field} must not be blank`);
    }
    return this.dataSource.transaction(async (manager) => {
      const medicines = manager.getRepository(Medicine);
      const row = await medicines.findOneBy({ id });
      if (!row) throw new NotFoundException('Medicine not found');
      if (dto.generic_name !== undefined) row.generic_name = dto.generic_name.trim();
      if (dto.brand !== undefined) row.brand_name = dto.brand.trim();
      if (dto.strength !== undefined) row.strength = dto.strength.trim();
      if (dto.gtin !== undefined) row.gtin = dto.gtin;
      const saved = await medicines.save(row);
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User, action: 'MEDICINE_UPDATED',
        description: `Medicine ${id} updated; fields: ${Object.keys(dto).join(', ')}`,
        ip_address: ip || 'unknown', event_key: null,
        object_type: 'medicine', object_id: id, request_id: null,
        before_status: null, after_status: 'ACTIVE',
      });
      return ResponseHelper.Success('Medicine updated', { ...saved, brand: saved.brand_name });
    });
  }
  async remove(id: string, actorId: string, ip: string) {
    return this.dataSource.transaction(async (manager) => {
      const medicines = manager.getRepository(Medicine);
      const row = await medicines.findOneBy({ id });
      if (!row) throw new NotFoundException('Medicine not found');
      await medicines.softDelete({ id });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User, action: 'MEDICINE_REMOVED',
        description: `Medicine ${id} removed from active catalog using soft delete`,
        ip_address: ip || 'unknown', event_key: null,
        object_type: 'medicine', object_id: id, request_id: null,
        before_status: 'ACTIVE', after_status: 'REMOVED',
      });
      return ResponseHelper.Success('Medicine removed from active use', { id, status: 'REMOVED' });
    });
  }
}
