import { PartialType } from '@nestjs/mapped-types';
import { CreateHospitalDto } from './create-hospital.dto';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIP,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FacilityStatus } from '../entities/hospital.entity';

export class UpdateHospitalDto extends PartialType(CreateHospitalDto) {
  @IsOptional() @IsEnum(FacilityStatus) status?: FacilityStatus;
  @IsOptional()
  @IsArray()
  @IsIP(undefined, { each: true })
  ip_whitelist?: string[];
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
  @IsOptional() @IsBoolean() membership_open?: boolean;
}
