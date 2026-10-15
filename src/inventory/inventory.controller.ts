import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

type FacilityRequest = Request & { user?: { facilityId?: string } };

@Controller('api/inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post() create(@Body() dto: CreateInventoryDto, @Req() req: FacilityRequest) {
    return this.inventoryService.create(dto, req.user?.facilityId);
  }
  @Get('export.csv') exportCsv(@Req() req: FacilityRequest) {
    return this.inventoryService.exportCsv(req.user?.facilityId);
  }
  @Get() findAll(
    @Query('category') category?: string,
    @Query('facilityId') facilityId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: FacilityRequest,
  ) {
    return this.inventoryService.findAll({
      category,
      facilityId,
      authenticatedFacilityId: req?.user?.facilityId,
      q,
      page: Number(page),
      limit: Number(limit),
    });
  }
  @Get(':id') findOne(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.findOne(id, req.user?.facilityId);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.inventoryService.update(id, dto, req.user?.facilityId);
  }
  @Post(':id/quarantine') quarantine(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.setStatus(id, 'QUARANTINED', req.user?.facilityId);
  }
  @Post(':id/dispose') dispose(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.setStatus(id, 'DISPOSED', req.user?.facilityId);
  }
  @Delete(':id') remove(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.inventoryService.remove(id, req.user?.facilityId);
  }
}

@Controller('api/stock')
@UseGuards(AuthGuard)
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
@UseGuards(AuthGuard)
export class ExpiryController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get() list(@Query('withinDays') days?: string, @Req() req?: FacilityRequest) {
    return this.inventoryService.findExpiry(Number(days) || 60, 500, req?.user?.facilityId);
  }
}

@Controller('api/inventory/near-expiry')
@UseGuards(AuthGuard)
export class NearExpiryController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get() list(@Query('limit') limit?: string, @Req() req?: FacilityRequest) {
    return this.inventoryService.findExpiry(60, Number(limit) || 7, req?.user?.facilityId);
  }
}
