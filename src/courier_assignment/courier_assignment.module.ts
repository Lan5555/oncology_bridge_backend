import { Module } from '@nestjs/common';
import { CourierAssignmentService } from './courier_assignment.service';
import { CourierAssignmentController } from './courier_assignment.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourierAssignment } from './entities/courier_assignment.entity';
import { Courier } from '../courier/entities/courier.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CourierAssignment, Courier, TransferRequest]),
  ],
  controllers: [CourierAssignmentController],
  providers: [CourierAssignmentService],
})
export class CourierAssignmentModule {}
