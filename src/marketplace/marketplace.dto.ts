import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CATEGORIES = [
  'Biologics',
  'Chemotherapy',
  'Supportive care',
  'Other',
];
export class CreateListingDto {
  @IsUUID() inventoryItemId!: string;
  @IsIn(CATEGORIES) category!: string;
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/)
  unitPriceNaira!: string;
  @IsString() @Matches(/^[1-9]\d{0,8}$/) availableQuantity!: string;
  @IsIn(['vial', 'pack', 'bottle', 'box']) unit!: string;
  @IsString() @Length(1, 500) storage!: string;
  @IsString() @Length(1, 2000) description!: string;
  @IsIn(['true', 'false']) prescriptionRequired!: string;
}
export class ListingQueryDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsIn(['', ...CATEGORIES]) category?: string;
  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'expiry_asc'])
  sort?: string;
  @IsOptional() @IsIn(['true', 'false']) inStock?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 12;
}
export class CheckoutDto {
  @IsUUID() listingId!: string;
  @IsInt() @Min(1) @Max(999999999) quantity!: number;
  @IsOptional() @IsUUID() prescriptionId?: string;
}
