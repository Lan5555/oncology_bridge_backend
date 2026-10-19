import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { Settlement } from './entities/settlement.entity';
import { MarketplaceService } from '../marketplace/marketplace.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Settlement)
    private readonly settlements: Repository<Settlement>,
    private readonly marketplace: MarketplaceService,
  ) {}
  async create(data: Partial<Invoice>) {
    const row = this.invoices.create({
      ...data,
      reference:
        data.reference ?? `OB-${Date.now().toString(36).toUpperCase()}`,
      status: 'AWAITING_PAYMENT',
    });
    return this.invoices.save(row);
  }
  async findPublic(reference: string, actorId?: string) {
    const marketplaceInvoice = await this.marketplace.invoice(
      reference,
      actorId,
    );
    if (marketplaceInvoice) return marketplaceInvoice;
    const row = await this.invoices.findOne({
      where: { reference },
      relations: { items: true },
    });
    if (!row) throw new NotFoundException('Invoice not found');
    return {
      reference: row.reference,
      status: row.status,
      totalNaira: row.total_naira,
      items: row.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPriceNaira: i.unit_price_naira,
      })),
      paymentMethods: ['Debit card', 'Bank transfer', 'USSD'],
      isDemo: true,
    };
  }
  async summary() {
    const rows = await this.settlements.find();
    return {
      currency: 'NGN',
      transactionCount: rows.length,
      transactionVolumeNaira: rows.reduce((n, x) => n + x.amount_naira, 0),
      platformFeesNaira: rows.reduce((n, x) => n + x.platform_fee_naira, 0),
      payoutsQueued: rows.filter((x) => x.payout_status === 'QUEUED').length,
    };
  }
}
