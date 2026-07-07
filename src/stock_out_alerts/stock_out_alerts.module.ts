import { Module } from '@nestjs/common';
import { StockOutAlertsService } from './stock_out_alerts.service';
import { StockOutAlertsController } from './stock_out_alerts.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockOutAlert } from './entities/stock_out_alert.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StockOutAlert])],
  controllers: [StockOutAlertsController],
  providers: [StockOutAlertsService],
})
export class StockOutAlertsModule {}
