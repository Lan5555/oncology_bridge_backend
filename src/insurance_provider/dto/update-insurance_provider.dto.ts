import { PartialType } from '@nestjs/mapped-types';
import { CreateInsuranceProviderDto } from './create-insurance_provider.dto';

export class UpdateInsuranceProviderDto extends PartialType(CreateInsuranceProviderDto) {}
