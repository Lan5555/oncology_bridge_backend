import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class MonitorSettingsDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) provider!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) deviceId!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false }) minCelsius!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) maxCelsius!: number;
  @IsInt() @Min(30) @Max(86400) staleAfterSeconds!: number;
}
export class CreateShipmentMonitorDto extends MonitorSettingsDto {
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() courierAssignmentId?: string;
  @IsOptional() @IsUUID() courierId?: string;
}
export class UpdateShipmentMonitorDto extends MonitorSettingsDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class ShipmentPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
