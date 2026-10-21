import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Controller,
  Get,
  Header,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  Ip,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { InventoryManagementGuard } from '../guards/inventory-management.guard';
import { DashboardReadGuard } from '../guards/dashboard-read.guard';
import { InventoryService } from './inventory.service';
import { ManualInventoryIntakeDto } from './dto/manual-inventory-intake.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

type FacilityRequest = Request & { user?: { id: string; facilityId?: string } };

@Controller('api/inventory')
@UseGuards(AuthGuard, OperationalReadGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly reads: OperationalReadsService,
  ) {}

  @Post() @UseGuards(InventoryManagementGuard) create(
    @Body() dto: ManualInventoryIntakeDto,
    @Req() req: FacilityRequest,
    @Ip() ip: string,
  ) {
    return this.inventoryService.create(dto, req.user!.id, ip);
  }
  @Get('export.csv') exportCsv(@Req() req: FacilityRequest) {
    return this.inventoryService.exportCsv(req.user?.facilityId);
  }
  @Get('near-expiry')
  @UseGuards(DashboardReadGuard)
  @Header('Cache-Control', 'private, no-store')
  nearExpiry(
    @Query('limit') limit: string | undefined,
    @Req() req: FacilityRequest,
  ) {
    return this.inventoryService.findExpiry(
      60,
      Number(limit) || 7,
      req.user!.facilityId,
    );
  }
  @Get() findAll(
    @Query() query: OperationalQueryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.reads.list('inventory', req.user?.id, query);
  }

  @Get(':id') findOne(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.findOne(id, req.user?.facilityId);
  }
  @UseGuards(InventoryManagementGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
    @Req() req: FacilityRequest,
    @Ip() ip: string,
  ) {
    return this.inventoryService.update(
      id,
      dto,
      req.user?.facilityId,
      req.user!.id,
      ip,
    );
  }
  @UseGuards(InventoryManagementGuard)
  @Post(':id/quarantine')
  quarantine(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.setStatus(
      id,
      'QUARANTINED',
      req.user?.facilityId,
    );
  }
  @UseGuards(InventoryManagementGuard)
  @Post(':id/dispose')
  dispose(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.setStatus(
      id,
      'DISPOSED',
      req.user?.facilityId,
    );
  }
  @UseGuards(InventoryManagementGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.remove(id, req.user?.facilityId);
  }
}

@Controller('api/stock')
@UseGuards(AuthGuard, OperationalReadGuard)
export class StockSearchController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get('search') search(
    @Req() req: FacilityRequest,
    @Query('q') q?: string,
    @Query('location') location?: string,
  ) {
    return this.inventoryService.stockSearch(q, location, req.user?.facilityId);
  }
}

@Controller('api/expiry')
@UseGuards(AuthGuard, OperationalReadGuard)
export class ExpiryController {
  constructor(private readonly reads: OperationalReadsService) {}
  @Get() list(
    @Query() query: OperationalQueryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.reads.list('expiry', req.user?.id, query);
  }
}
