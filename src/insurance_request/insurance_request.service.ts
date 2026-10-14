import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsuranceRequest } from './entities/insurance_request.entity';
import { InsuranceProvider } from '../insurance_provider/entities/insurance_provider.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';
import { CreateInsuranceRequestDto } from './dto/create-insurance_request.dto';
import { UpdateInsuranceRequestDto } from './dto/update-insurance_request.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class InsuranceRequestService {
  constructor(
    @InjectRepository(InsuranceRequest)
    private readonly requests: Repository<InsuranceRequest>,
    @InjectRepository(InsuranceProvider)
    private readonly providers: Repository<InsuranceProvider>,
    @InjectRepository(TransferRequest)
    private readonly transfers: Repository<TransferRequest>,
  ) {}
  async create(dto: CreateInsuranceRequestDto) {
    const [provider, transfer] = await Promise.all([
      this.providers.findOneBy({ id: dto.providerId }),
      this.transfers.findOneBy({ id: dto.transferId }),
    ]);
    if (!provider || !transfer)
      throw new NotFoundException('Provider or associated order not found');
    if (!provider.active)
      throw new BadRequestException('Insurance provider is inactive');
    const row = this.requests.create({
      provider,
      transfer,
      status: 'PENDING',
      response: 'MOCK: insurer integration is not configured',
    });
    return ResponseHelper.Success(
      'Authorization request recorded; insurer response is mocked',
      await this.requests.save(row),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Insurance requests retrieved',
      await this.requests.find({
        relations: { provider: true, transfer: true },
        order: { created_at: 'DESC' },
      }),
    );
  }
  async findOne(id: string) {
    const row = await this.requests.findOne({
      where: { id },
      relations: { provider: true, transfer: true },
    });
    if (!row) throw new NotFoundException('Insurance request not found');
    return ResponseHelper.Success('Insurance request retrieved', row);
  }
  async update(id: string, dto: UpdateInsuranceRequestDto) {
    const row = await this.requests.findOneBy({ id });
    if (!row) throw new NotFoundException('Insurance request not found');
    if (dto.status) row.status = dto.status;
    if (dto.authorization_code) row.authorization_code = dto.authorization_code;
    if (dto.response !== undefined) row.response = dto.response;
    return ResponseHelper.Success(
      'Insurance request updated',
      await this.requests.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.requests.findOneBy({ id });
    if (!row) throw new NotFoundException('Insurance request not found');
    await this.requests.remove(row);
    return ResponseHelper.Success('Insurance request removed', null);
  }
}
