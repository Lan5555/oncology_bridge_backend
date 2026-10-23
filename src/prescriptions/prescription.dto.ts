import {
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
import { ICD10_INPUT_MESSAGE } from './icd10';
export class CreatePrescriptionDto {
  @IsString() @Length(1, 200) @Matches(/\S/) patient_ref!: string;
  @IsString({ message: ICD10_INPUT_MESSAGE })
  @Length(1, 200, { message: ICD10_INPUT_MESSAGE })
  icd10!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() @Length(1, 80) tnm_stage?: string;
  @IsString() @Length(1, 120) insurer!: string;
  @IsUUID() drug_id!: string;
  @IsInt() @Min(1) @Max(2147483647) qty!: number;
  @IsUUID() pharmacy_facility_id!: string;
  @IsOptional() @IsUUID() prescriber_id?: string;
}
