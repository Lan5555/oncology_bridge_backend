import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class PatchMedicineCatalogDto {
  @IsOptional() @IsString() @Length(1, 240) generic_name?: string;
  @IsOptional() @IsString() @Length(1, 240) brand?: string;
  @IsOptional() @IsString() @Length(1, 120) strength?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, { message: 'gtin must be a 14 digit GTIN-14' })
  gtin?: string;
}
