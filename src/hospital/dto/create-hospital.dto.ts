import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { FacilityType } from '../entities/hospital.entity';

export class CreateHospitalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsEnum(FacilityType)
  facility_type!: FacilityType;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,24}$/)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state!: string;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;
}
