import { IsBoolean, IsOptional, IsString } from 'class-validator';
export class CreateInsuranceProviderDto {
  @IsString() name!: string;
  @IsString() api_url!: string;
  @IsString() auth_type!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
