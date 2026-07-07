import { PartialType } from '@nestjs/mapped-types';
import { CreateStockOutAlertDto } from './create-stock_out_alert.dto';

export class UpdateStockOutAlertDto extends PartialType(CreateStockOutAlertDto) {}
