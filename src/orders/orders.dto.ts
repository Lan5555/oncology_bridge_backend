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
  ValidateIf,
} from 'class-validator';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
const filter = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OrderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @Transform(filter)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
  @Transform(filter)
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: string;
  @Transform(filter)
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: string;
}

export class FulfillmentDto {
  @IsIn(['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
  status!: string;
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
  @ValidateIf(
    (o: FulfillmentDto) => o.status === 'SHIPPED' || o.carrier !== undefined,
  )
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  carrier?: string;
  @ValidateIf(
    (o: FulfillmentDto) =>
      o.status === 'SHIPPED' || o.trackingNumber !== undefined,
  )
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  trackingNumber?: string;
}
