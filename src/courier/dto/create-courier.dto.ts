import { IsBoolean, IsOptional, IsString } from 'class-validator';
export class CreateCourierDto {
  @IsString() name!: string;
  @IsString() phone!: string;
  @IsString() company!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
