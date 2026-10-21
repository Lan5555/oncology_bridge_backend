import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class OperationalQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeDeletedMedicines?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) =>
    Number.isInteger(value) && value > 100 ? 100 : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsUUID() facilityId?: string;
  @IsOptional() @IsString() @MaxLength(50) status?: string;
  @IsOptional()
  @IsIn(['all', 'expiry', 'quarantine', 'redistributed'])
  category?: string;
  @IsOptional() @IsIn(['active', 'awaiting', 'completed', 'all']) tab?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) withinDays = 60;
}
