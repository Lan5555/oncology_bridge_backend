import { Module } from '@nestjs/common';
import { CourierAssignmentService } from './courier_assignment.service';
import { CourierAssignmentController } from './courier_assignment.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourierAssignment } from './entities/courier_assignment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CourierAssignment])],
  controllers: [CourierAssignmentController],
  providers: [CourierAssignmentService],
})
export class CourierAssignmentModule {}
