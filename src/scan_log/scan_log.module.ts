import { Module } from '@nestjs/common';
import { ScanLogService } from './scan_log.service';
import { ScanLogController } from './scan_log.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScanLog } from './entities/scan_log.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { Gs1ImageDecoderService } from './gs1-image-decoder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScanLog,
      Inventory,
      Medicine,
      Hospital,
      User,
      AuditLog,
    ]),
  ],
  controllers: [ScanLogController],
  providers: [ScanLogService, Gs1ImageDecoderService],
})
export class ScanLogModule {}
