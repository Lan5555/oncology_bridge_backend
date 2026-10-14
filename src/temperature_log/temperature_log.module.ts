import { Module } from '@nestjs/common';
import { TemperatureLogService } from './temperature_log.service';
import { ColdChainController } from './coldchain.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemperatureLog } from './entities/temperature_log.entity';
import { User } from '../users/entities/user.entity';
import { StorageUnitsModule } from '../storage_units/storage-units.module';
import { ColdChainEventsModule } from '../cold_chain_events/cold-chain-events.module';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';

@Module({
  imports: [
    StorageUnitsModule,
    ColdChainEventsModule,
    TypeOrmModule.forFeature([TemperatureLog, User, StorageUnit]),
  ],
  controllers: [ColdChainController],
  providers: [TemperatureLogService],
})
export class TemperatureLogModule {}
