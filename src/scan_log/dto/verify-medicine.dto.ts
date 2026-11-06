import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';

export class VerifyMedicineDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 /-]{1,49}$/)
  nafdacNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  rawBarcode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/)
  gtin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;
}

export class VerifyMedicineImageDto extends OmitType(VerifyMedicineDto, [
  'rawBarcode',
  'gtin',
] as const) {}
