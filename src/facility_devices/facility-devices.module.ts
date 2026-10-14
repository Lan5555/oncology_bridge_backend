import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacilityDevice } from './entities/facility-device.entity';
@Module({
  imports: [TypeOrmModule.forFeature([FacilityDevice])],
  exports: [TypeOrmModule],
})
export class FacilityDevicesModule {}
