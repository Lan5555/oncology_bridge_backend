import { IsString } from 'class-validator';
export class CreateMedicineDto {
  @IsString() gtin!: string;
  @IsString() generic_name!: string;
  @IsString() brand_name!: string;
  @IsString() manufacturer!: string;
  @IsString() strength!: string;
  @IsString() dosage_form!: string;
  @IsString() storage_temperature!: string;
}
