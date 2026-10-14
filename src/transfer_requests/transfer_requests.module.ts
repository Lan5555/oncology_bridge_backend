import { Module } from '@nestjs/common';
import { TransferRequestsService } from './transfer_requests.service';
import { TransferRequestsController } from './transfer_requests.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransferRequest } from './entities/transfer_request.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransferRequest, Inventory, Hospital])],
  controllers: [TransferRequestsController],
  providers: [TransferRequestsService],
})
export class TransferRequestsModule {}
