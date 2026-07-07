import { Module } from '@nestjs/common';
import { TemperatureLogService } from './temperature_log.service';
import { TemperatureLogController } from './temperature_log.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemperatureLog } from './entities/temperature_log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TemperatureLog])],
  controllers: [TemperatureLogController],
  providers: [TemperatureLogService],
})
export class TemperatureLogModule {}
