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
import { MedicineVerificationController } from './medicine-verification.controller';
import { MedicineVerificationService } from './medicine-verification.service';
import { OpenFdaLabelService } from './openfda-label.service';
import { ConfigModule } from '@nestjs/config';
import { NafdacRegistrationService } from './nafdac-registration.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ScanLog,
      Inventory,
      Medicine,
      Hospital,
      User,
      AuditLog,
    ]),
  ],
  controllers: [ScanLogController, MedicineVerificationController],
  providers: [
    ScanLogService,
    Gs1ImageDecoderService,
    MedicineVerificationService,
    OpenFdaLabelService,
    NafdacRegistrationService,
  ],
})
export class ScanLogModule {}
