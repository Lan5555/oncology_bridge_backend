import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class PrescriptionReviewQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsIn(['Pending', 'Approved', 'Rejected']) authStatus?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
export class PrescriptionDecisionDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: string;
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
