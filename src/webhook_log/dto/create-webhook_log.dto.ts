import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';
export class CreateWebhookLogDto {
  @IsString() provider!: string;
  @IsString() endpoint!: string;
  @IsObject() payload!: Record<string, any>;
  @IsOptional() @IsObject() response?: Record<string, any>;
  @IsInt() status_code!: number;
}
