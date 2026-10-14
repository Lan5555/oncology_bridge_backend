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
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@Controller('api/inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post() create(@Body() dto: CreateInventoryDto) {
    return this.inventoryService.create(dto);
  }
  @Get('export.csv') exportCsv() {
    return this.inventoryService.exportCsv();
  }
  @Get() findAll(
    @Query('category') category?: string,
    @Query('facilityId') facilityId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.findAll({
      category,
      facilityId,
      q,
      page: Number(page),
      limit: Number(limit),
    });
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.inventoryService.findOne(id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.inventoryService.update(id, dto);
  }
  @Post(':id/quarantine') quarantine(@Param('id') id: string) {
    return this.inventoryService.setStatus(id, 'QUARANTINED');
  }
  @Post(':id/dispose') dispose(@Param('id') id: string) {
    return this.inventoryService.setStatus(id, 'DISPOSED');
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.inventoryService.remove(id);
  }
}

@Controller('api/stock')
export class StockSearchController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get('search') search(
    @Query('q') q?: string,
    @Query('location') location?: string,
  ) {
    return this.inventoryService.stockSearch(q, location);
  }
}

@Controller('api/expiry')
@UseGuards(AuthGuard)
export class ExpiryController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get() list(@Query('withinDays') days?: string) {
    return this.inventoryService.findExpiry(Number(days) || 60);
  }
}

@Controller('api/inventory/near-expiry')
@UseGuards(AuthGuard)
export class NearExpiryController {
  constructor(private readonly inventoryService: InventoryService) {}
  @Get() list(@Query('limit') limit?: string) {
    return this.inventoryService.findExpiry(60, Number(limit) || 7);
  }
}
