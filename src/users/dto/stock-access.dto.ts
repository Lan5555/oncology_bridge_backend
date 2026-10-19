import { IsBoolean } from 'class-validator';
export class StockAccessDto {
  @IsBoolean() enabled!: boolean;
}
