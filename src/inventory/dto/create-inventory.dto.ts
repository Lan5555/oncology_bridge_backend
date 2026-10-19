import {
  IsDateString,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateInventoryDto {
  @IsOptional()
  @IsIn(['vial', 'pack', 'bottle', 'box'])
  sellingUnit?: string;

  @IsOptional()
  @IsUUID()
  hospitalId?: string;

  @IsOptional()
  @IsUUID()
  facilityId?: string;

  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @IsOptional()
  @IsUUID()
  drugId?: string;

  @IsOptional()
  @IsString()
  drug?: string;

  @IsOptional()
  @IsString()
  batch_number?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  serial_number?: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

  @IsOptional()
  @IsDateString()
  expiry?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  status?: string;
}
