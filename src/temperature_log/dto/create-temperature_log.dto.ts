import { IsOptional, IsNumber, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
export class CreateTemperatureLogDto {
  @IsUUID() transferId!: string;
  @Type(() => Number) @IsNumber() temperature!: number;
  @IsOptional() @IsString() ts?: string;
  @IsOptional() @IsString() deviceKey?: string;
}
