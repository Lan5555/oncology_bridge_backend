import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IotDevice } from './entities/iot-device.entity';
import { IotDeviceUnit } from './entities/iot-device-unit.entity';
import { IotRequestNonce } from './entities/iot-request-nonce.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { TemperatureLog } from '../temperature_log/entities/temperature_log.entity';
import { ColdChainEvent } from '../cold_chain_events/entities/cold-chain-event.entity';
import { ColdChainOutbox } from '../cold_chain_events/entities/cold-chain-outbox.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notification/entities/notification.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { ColdChainEventsModule } from '../cold_chain_events/cold-chain-events.module';
import { IotReadingsService } from './iot-readings.service';
import { IotDevicesService } from './iot-devices.service';
import { IotReadingsController } from './iot-readings.controller';
import { IotDevicesController } from './iot-devices.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IotDevice,
      IotDeviceUnit,
      IotRequestNonce,
      StorageUnit,
      TemperatureLog,
      ColdChainEvent,
      ColdChainOutbox,
      Inventory,
      Hospital,
      User,
      Notification,
      AuditLog,
    ]),
    ColdChainEventsModule,
  ],
  controllers: [IotReadingsController, IotDevicesController],
  providers: [IotReadingsService, IotDevicesService],
  exports: [IotReadingsService],
})
export class IotDevicesModule {}
