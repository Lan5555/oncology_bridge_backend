import { Module } from '@nestjs/common';
import { StockOutAlertsService } from './stock_out_alerts.service';
import { StockOutAlertsController } from './stock_out_alerts.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockOutAlert } from './entities/stock_out_alert.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StockOutAlert, Hospital, Medicine])],
  controllers: [StockOutAlertsController],
  providers: [StockOutAlertsService],
})
export class StockOutAlertsModule {}
