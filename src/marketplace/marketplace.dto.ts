/* eslint-disable no-control-regex -- Business labels must reject control characters. */
import { SELLING_UNITS } from '../inventory/selling-unit';
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
import { Transform, Type } from 'class-transformer';

export class CreateListingDto {
  @IsUUID() inventoryItemId!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 100, { message: 'category must contain 1 to 100 characters' })
  @Matches(/^[^\u0000-\u001f\u007f]+$/, {
    message: 'category cannot contain control characters',
  })
  category!: string;
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/)
  unitPriceNaira!: string;
  @IsString() @Matches(/^[1-9]\d{0,8}$/) availableQuantity!: string;
  @IsIn(SELLING_UNITS) unit!: string;
  @IsString() @Length(1, 500) storage!: string;
  @IsString() @Length(1, 2000) description!: string;
  @IsIn(['true', 'false']) prescriptionRequired!: string;
}
export class ListingQueryDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @MaxLength(100, { message: 'category cannot exceed 100 characters' })
  @Matches(/^[^\u0000-\u001f\u007f]*$/, {
    message: 'category cannot contain control characters',
  })
  category?: string;
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
