import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  first_name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  last_name!: string;

  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,24}$/)
  phone!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  device_id!: string;
}
