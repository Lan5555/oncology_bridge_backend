import {
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateStorageUnitDto {
  @IsUUID() facility_id!: string;
  @IsString() label!: string;
  @IsIn(['FRIDGE', 'TRANSIT']) kind!: string;
  @IsNumber() @Min(-40) @Max(20) target_min!: number;
  @IsNumber() @Min(-20) @Max(40) target_max!: number;
  @IsInt() @Min(30) offline_after_seconds!: number;
}
