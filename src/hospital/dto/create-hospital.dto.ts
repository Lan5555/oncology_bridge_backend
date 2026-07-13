import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FacilityType } from '../entities/hospital.entity';

export class CreateHospitalDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEnum(FacilityType)
  facility_type!: FacilityType;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsString()
  address!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;
}
