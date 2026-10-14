import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
export class CreateStockOutAlertDto {
  @IsUUID() hospitalId!: string;
  @IsUUID() medicineId!: string;
  @IsInt() @Min(1) requested_quantity!: number;
  @IsOptional() @IsString() status?: string;
}
