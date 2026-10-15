import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { Invoice } from './entities/invoice.entity';
import { InvoicesService } from './invoices.service';

@Controller()
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}
  @Post('api/invoices') @UseGuards(AuthGuard) create(
    @Body() body: Partial<Invoice>,
  ) {
    return this.service.create(body);
  }
  @Get('api/invoices/:reference') publicInvoice(
    @Param('reference') reference: string,
  ) {
    return this.service.findPublic(reference);
  }
  @Get('api/settlements/summary') @UseGuards(AuthGuard, NetworkAdminGuard) summary() {
    return this.service.summary();
  }
}
