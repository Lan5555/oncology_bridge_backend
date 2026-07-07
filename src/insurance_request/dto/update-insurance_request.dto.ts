import { PartialType } from '@nestjs/mapped-types';
import { CreateInsuranceRequestDto } from './create-insurance_request.dto';

export class UpdateInsuranceRequestDto extends PartialType(CreateInsuranceRequestDto) {}
