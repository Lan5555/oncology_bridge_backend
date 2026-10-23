import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsIn,
  IsString,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export const PROFESSIONAL_TYPES = [
  'DOCTOR',
  'PHARMACIST',
  'PHARMACY_STORE',
] as const;
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional() @IsBoolean() is_active?: boolean;

  @ValidateIf((o: UpdateUserDto) => o.account_type !== undefined)
  @IsIn(PROFESSIONAL_TYPES)
  account_type?: string;

  @ValidateIf(
    (o: UpdateUserDto) =>
      o.account_type !== undefined || o.expected_account_type !== undefined,
  )
  @IsIn([...PROFESSIONAL_TYPES, null])
  expected_account_type?: string | null;

  @ValidateIf(
    (o: UpdateUserDto) =>
      o.account_type !== undefined ||
      o.account_type_change_reason !== undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  account_type_change_reason?: string;
}
