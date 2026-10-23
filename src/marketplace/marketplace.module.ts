import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ConfigModule } from '@nestjs/config';
import { EncryptionModule } from '../encryption/encryption.module';
import {
  MarketplaceController,
  MarketplacePaymentsController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { CloudinaryImagesService } from './cloudinary-images.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [ConfigModule, EncryptionModule, OrdersModule],
  controllers: [MarketplaceController, MarketplacePaymentsController],
  providers: [MarketplaceService, CloudinaryImagesService, PaystackService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
