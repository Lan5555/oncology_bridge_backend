import { Module } from '@nestjs/common';
import { InsuranceRequestService } from './insurance_request.service';
import { InsuranceRequestController } from './insurance_request.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsuranceRequest } from './entities/insurance_request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InsuranceRequest])],
  controllers: [InsuranceRequestController],
  providers: [InsuranceRequestService],
})
export class InsuranceRequestModule {}
