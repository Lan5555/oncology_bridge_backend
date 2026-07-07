import { Module } from '@nestjs/common';
import { ScanLogService } from './scan_log.service';
import { ScanLogController } from './scan_log.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScanLog } from './entities/scan_log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ScanLog])],
  controllers: [ScanLogController],
  providers: [ScanLogService],
})
export class ScanLogModule {}
