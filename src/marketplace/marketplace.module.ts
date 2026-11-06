import { FlutterwaveService } from './flutterwave.service';
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ConfigModule } from '@nestjs/config';
import { EncryptionModule } from '../encryption/encryption.module';
import {
  FlutterwavePaymentsController,
  MarketplaceController,
  MarketplacePaymentsController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { CloudinaryImagesService } from './cloudinary-images.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [ConfigModule, EncryptionModule, OrdersModule],
  controllers: [
    MarketplaceController,
    MarketplacePaymentsController,
    FlutterwavePaymentsController,
  ],
  providers: [
    MarketplaceService,
    CloudinaryImagesService,
    PaystackService,
    FlutterwaveService,
  ],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
