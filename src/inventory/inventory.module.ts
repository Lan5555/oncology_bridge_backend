import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import {
  ExpiryController,
  InventoryController,
  StockSearchController,
} from './inventory.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventory } from './entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Inventory, Hospital, Medicine])],
  controllers: [InventoryController, StockSearchController, ExpiryController],
  providers: [InventoryService],
})
export class InventoryModule {}
