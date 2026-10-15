import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class FacilityInviteDto extends CreateUserDto {
  @IsIn(['ONCOLOGIST', 'PHARMACIST']) role_name!: 'ONCOLOGIST' | 'PHARMACIST';
  @IsString() @Matches(/^[A-Za-z0-9/\-]{4,24}$/) license_number!: string;
  @IsIn(['MDCN', 'PCN']) license_registry!: 'MDCN' | 'PCN';
}
