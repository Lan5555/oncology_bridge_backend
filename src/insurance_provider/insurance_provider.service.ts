import { Injectable } from '@nestjs/common';
import { CreateInsuranceProviderDto } from './dto/create-insurance_provider.dto';
import { UpdateInsuranceProviderDto } from './dto/update-insurance_provider.dto';

@Injectable()
export class InsuranceProviderService {
  create(createInsuranceProviderDto: CreateInsuranceProviderDto) {
    return 'This action adds a new insuranceProvider';
  }

  findAll() {
    return `This action returns all insuranceProvider`;
  }

  findOne(id: number) {
    return `This action returns a #${id} insuranceProvider`;
  }

  update(id: number, updateInsuranceProviderDto: UpdateInsuranceProviderDto) {
    return `This action updates a #${id} insuranceProvider`;
  }

  remove(id: number) {
    return `This action removes a #${id} insuranceProvider`;
  }
}
