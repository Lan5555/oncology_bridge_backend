import { Module } from '@nestjs/common';
import { GuardsModule } from '../guards/guards.module';
import {
  AdminShipmentsController,
  ShipmentsController,
} from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import {
  PendingShipmentProvider,
  SHIPMENT_TEMPERATURE_PROVIDER,
} from './shipment-provider';

@Module({
  imports: [GuardsModule],
  controllers: [ShipmentsController, AdminShipmentsController],
  providers: [
    ShipmentsService,
    {
      provide: SHIPMENT_TEMPERATURE_PROVIDER,
      useClass: PendingShipmentProvider,
    },
  ],
})
export class ShipmentsModule {}
