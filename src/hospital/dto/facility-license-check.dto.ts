import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class FacilityLicenseCheckDto {
  @IsIn(['MATCH', 'NO_MATCH', 'UNAVAILABLE', 'INCONCLUSIVE'])
  result!: 'MATCH' | 'NO_MATCH' | 'UNAVAILABLE' | 'INCONCLUSIVE';

  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  evidence!: string;
}
