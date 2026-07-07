import { Injectable } from '@nestjs/common';
import { CreateInsuranceRequestDto } from './dto/create-insurance_request.dto';
import { UpdateInsuranceRequestDto } from './dto/update-insurance_request.dto';

@Injectable()
export class InsuranceRequestService {
  create(createInsuranceRequestDto: CreateInsuranceRequestDto) {
    return 'This action adds a new insuranceRequest';
  }

  findAll() {
    return `This action returns all insuranceRequest`;
  }

  findOne(id: number) {
    return `This action returns a #${id} insuranceRequest`;
  }

  update(id: number, updateInsuranceRequestDto: UpdateInsuranceRequestDto) {
    return `This action updates a #${id} insuranceRequest`;
  }

  remove(id: number) {
    return `This action removes a #${id} insuranceRequest`;
  }
}
