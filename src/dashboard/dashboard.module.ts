import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';
import {
  DashboardController,
  PublicStatsController,
  ReportsController,
} from './dashboard.controller';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { ScanLog } from '../scan_log/entities/scan_log.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hospital, Inventory, ScanLog, TransferRequest]),
  ],
  controllers: [DashboardController, PublicStatsController, ReportsController],
  providers: [DashboardService, ReportsService],
})
export class DashboardModule {}
