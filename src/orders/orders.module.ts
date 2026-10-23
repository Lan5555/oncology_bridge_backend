import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { GuardsModule } from '../guards/guards.module';
import {
  AdminOrdersController,
  BuyerOrdersController,
} from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderTrackingService } from './order-tracking.service';

@Module({
  imports: [EmailModule, EncryptionModule, GuardsModule],
  controllers: [BuyerOrdersController, AdminOrdersController],
  providers: [OrdersService, OrderTrackingService],
  exports: [OrderTrackingService],
})
export class OrdersModule {}
