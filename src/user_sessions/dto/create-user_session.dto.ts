import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
export class CreateUserSessionDto {
  @IsUUID() userId!: string;
  @IsString() refresh_token!: string;
  @IsString() device_id!: string;
  @IsString() ip_address!: string;
  @IsOptional() @IsDateString() expires_at?: string;
}
