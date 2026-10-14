import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageUnit } from './entities/storage-unit.entity';
import { StorageUnitsController } from './storage-units.controller';
import { StorageUnitsService } from './storage-units.service';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { TemperatureLog } from '../temperature_log/entities/temperature_log.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([StorageUnit, Hospital, User, TemperatureLog]),
  ],
  controllers: [StorageUnitsController],
  providers: [StorageUnitsService],
  exports: [TypeOrmModule, StorageUnitsService],
})
export class StorageUnitsModule {}
