import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ManifestPackDto {
  @IsString() @Matches(/^\d{14}$/) gtin!: string;
  @IsString() @Length(1, 20) @Matches(/^[!-~]+$/) serial!: string;
  @IsString() @Length(1, 20) @Matches(/^[!-~]+$/) lot!: string;
  @IsString() @Matches(/^(\d{6}|\d{4}-\d{2}-\d{2})$/) expiry!: string;
}

export class UploadManifestDto {
  @IsString() @Length(1, 120) @Matches(/\S/) reference!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ManifestPackDto)
  packs!: ManifestPackDto[];
}

export class CheckManifestDto {
  @IsString() @Length(1, 512) @MaxLength(512) rawBarcode!: string;
}

export class DispensePackDto extends CheckManifestDto {
  @IsUUID() clientUuid!: string;
}
