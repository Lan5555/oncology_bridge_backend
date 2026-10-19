import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Settlement } from './entities/settlement.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { InvoiceAuthGuard } from './invoice-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, Settlement]),
    MarketplaceModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceAuthGuard],
})
export class InvoicesModule {}
