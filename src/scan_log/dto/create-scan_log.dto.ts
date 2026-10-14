import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
export class CreateScanLogDto {
  @IsString() gtin!: string;
  @IsString() lot!: string;
  @IsString() serial!: string;
  @IsString() expiry!: string;
  @IsUUID() facilityId!: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsDateString() clientTs!: string;
  @IsIn(['NEW', 'AVAILABLE', 'NEAR_EXPIRY']) action!: string;
  @IsOptional() @IsString() notes?: string;
}
