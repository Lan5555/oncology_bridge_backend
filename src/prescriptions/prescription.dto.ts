import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
export class CreatePrescriptionDto {
  @IsString() @Length(1, 200) @Matches(/\S/) patient_ref!: string;
  @IsString() @Matches(/^C\d{2}(\.\d{1,2})?$/) icd10!: string;
  @IsOptional() @IsString() @Length(1, 80) tnm_stage?: string;
  @IsString() @Length(1, 120) insurer!: string;
  @IsUUID() drug_id!: string;
  @IsInt() @Min(1) @Max(2147483647) qty!: number;
  @IsUUID() pharmacy_facility_id!: string;
  @IsOptional() @IsUUID() prescriber_id?: string;
}
