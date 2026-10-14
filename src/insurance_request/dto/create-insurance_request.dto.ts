import { IsUUID } from 'class-validator';
export class CreateInsuranceRequestDto {
  @IsUUID() providerId!: string;
  @IsUUID() transferId!: string;
}
