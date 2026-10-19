import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InvoiceAuthGuard } from './invoice-auth.guard';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { Invoice } from './entities/invoice.entity';
import { InvoicesService } from './invoices.service';

@Controller()
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly reads: OperationalReadsService,
  ) {}
  @Get('api/invoices')
  @UseGuards(AuthGuard, OperationalReadGuard)
  list(
    @Req() req: Request & { user?: { id: string } },
    @Query() query: OperationalQueryDto,
  ) {
    return this.reads.list('invoices', req.user?.id, query);
  }
  @Post('api/invoices') @UseGuards(AuthGuard) create(
    @Body() body: Partial<Invoice>,
  ) {
    return this.service.create(body);
  }
  @Get('api/invoices/:reference') @UseGuards(InvoiceAuthGuard) publicInvoice(
    @Param('reference') reference: string,
    @Req() req: Request & { user?: { id: string } },
  ) {
    return this.service.findPublic(reference, req.user?.id);
  }
  @Get('api/settlements/summary')
  @UseGuards(AuthGuard, NetworkAdminGuard)
  summary() {
    return this.service.summary();
  }
}
