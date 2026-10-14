import { PartialType } from '@nestjs/mapped-types';
import { CreateInsuranceRequestDto } from './create-insurance_request.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateInsuranceRequestDto extends PartialType(
  CreateInsuranceRequestDto,
) {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() authorization_code?: string;
  @IsOptional() @IsString() response?: string;
}
