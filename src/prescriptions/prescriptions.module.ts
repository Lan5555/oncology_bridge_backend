import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Prescription } from './entities/prescription.entity';
import { OrderEvent } from './entities/order-event.entity';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { User } from '../users/entities/user.entity';
import { PrescriptionReviewController } from './prescription-review.controller';
import { PrescriptionReviewService } from './prescription-review.service';

@Module({
  imports: [TypeOrmModule.forFeature([Prescription, OrderEvent, User])],
  controllers: [PrescriptionsController, PrescriptionReviewController],
  providers: [PrescriptionsService, PrescriptionReviewService],
})
export class PrescriptionsModule {}
