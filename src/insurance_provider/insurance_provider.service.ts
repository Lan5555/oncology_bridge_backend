import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsuranceProvider } from './entities/insurance_provider.entity';
import { CreateInsuranceProviderDto } from './dto/create-insurance_provider.dto';
import { UpdateInsuranceProviderDto } from './dto/update-insurance_provider.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class InsuranceProviderService {
  constructor(
    @InjectRepository(InsuranceProvider)
    private readonly providers: Repository<InsuranceProvider>,
  ) {}
  async create(dto: CreateInsuranceProviderDto) {
    return ResponseHelper.Success(
      'Insurance provider created',
      await this.providers.save(this.providers.create(dto)),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Insurance providers retrieved',
      await this.providers.find({ relations: { requests: true } }),
    );
  }
  async findOne(id: string) {
    const row = await this.providers.findOne({
      where: { id },
      relations: { requests: true },
    });
    if (!row) throw new NotFoundException('Insurance provider not found');
    return ResponseHelper.Success('Insurance provider retrieved', row);
  }
  async update(id: string, dto: UpdateInsuranceProviderDto) {
    const row = await this.providers.findOneBy({ id });
    if (!row) throw new NotFoundException('Insurance provider not found');
    Object.assign(row, dto);
    return ResponseHelper.Success(
      'Insurance provider updated',
      await this.providers.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.providers.findOne({
      where: { id },
      relations: { requests: true },
    });
    if (!row) throw new NotFoundException('Insurance provider not found');
    if (row.requests?.length) {
      row.active = false;
      await this.providers.save(row);
      return ResponseHelper.Success(
        'Provider deactivated because it has request history',
        row,
      );
    }
    await this.providers.remove(row);
    return ResponseHelper.Success('Insurance provider deleted', null);
  }
}
