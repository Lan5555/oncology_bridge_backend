import { OperationalReadGuard } from '../guards/operational-read.guard';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadsService } from './operational-reads.service';
import { OperationalQueryDto } from './operational-query.dto';

@Controller('admin/api/marketplace/listings')
@UseGuards(AuthGuard, OperationalReadGuard)
export class AdminMarketplaceReadController {
  constructor(private readonly reads: OperationalReadsService) {}
  @Get() list(
    @Req() req: Request & { user: { id: string } },
    @Query() query: OperationalQueryDto,
  ) {
    return this.reads.list('marketplace', req.user.id, query);
  }
}
