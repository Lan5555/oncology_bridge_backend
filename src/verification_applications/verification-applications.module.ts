import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationApplication } from './entities/verification-application.entity';
import { VerificationApplicationsController } from './verification-applications.controller';
import { VerificationApplicationsService } from './verification-applications.service';
@Module({
  imports: [TypeOrmModule.forFeature([VerificationApplication])],
  controllers: [VerificationApplicationsController],
  providers: [VerificationApplicationsService],
})
export class VerificationApplicationsModule {}
