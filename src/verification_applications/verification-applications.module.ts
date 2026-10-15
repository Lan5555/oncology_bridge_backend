import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationApplication } from './entities/verification-application.entity';
import { AdminVerificationController, VerificationApplicationsController } from './verification-applications.controller';
import { VerificationApplicationsService } from './verification-applications.service';
import { User } from '../users/entities/user.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { Notification } from '../notification/entities/notification.entity';
import { EncryptionModule } from '../encryption/encryption.module';
@Module({
  imports: [TypeOrmModule.forFeature([VerificationApplication, User, Hospital, AuditLog, Notification]), EncryptionModule],
  controllers: [VerificationApplicationsController, AdminVerificationController],
  providers: [VerificationApplicationsService],
})
export class VerificationApplicationsModule {}
