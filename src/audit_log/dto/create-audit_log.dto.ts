import { IsOptional, IsString, IsUUID } from 'class-validator';
export class CreateAuditLogDto {
  @IsUUID() userId!: string;
  @IsString() action!: string;
  @IsString() description!: string;
  @IsOptional() @IsString() ip_address?: string;
}
