import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Inactive accounts cannot sign in. Verify their credentials for this operation
// without issuing a session or granting workspace access.
export class ResubmitVerificationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsIn(['MDCN', 'PCN', 'PCN_PREMISES']) registry!: string;
  @IsString() @Matches(/^[A-Za-z0-9/-]{4,24}$/) license_number!: string;
}
