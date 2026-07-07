import { Module } from '@nestjs/common';
import { AuditLogService } from './audit_log.service';
import { AuditLogController } from './audit_log.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit_log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
