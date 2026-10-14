import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class ProvisionIotDeviceDto {
  @IsString() deviceId!: string;
  @IsUUID() facilityId!: string;
  @IsString() secretRef!: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) unitIds!: string[];
  @IsInt() @Min(10) expectedIntervalSeconds = 300;
  @IsNumber() sensorMinCelsius = -40;
  @IsNumber() sensorMaxCelsius = 85;
}

export class RotateIotDeviceSecretDto {
  @IsString() secretRef!: string;
}
