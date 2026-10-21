import { Transform } from 'class-transformer';
import { SELLING_UNITS } from '../selling-unit';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class ManualInventoryIntakeDto {
  @IsUUID() medicineId!: string;
  @IsOptional() @IsUUID() facilityId?: string;
  @IsOptional() @IsUUID() hospitalId?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  batchNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  expiry!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() @MaxLength(200) serial_number?: string;
  @IsOptional() @IsIn(SELLING_UNITS) unit?: string;
  @IsOptional() @IsIn(SELLING_UNITS) sellingUnit?: string;
}
