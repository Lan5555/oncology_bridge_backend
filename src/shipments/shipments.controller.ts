import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import {
  CreateShipmentMonitorDto,
  ShipmentPageDto,
  UpdateShipmentMonitorDto,
} from './shipments.dto';
import { ShipmentsService } from './shipments.service';
type ShipmentRequest = Request & { user: { id: string } };

@Controller('api/shipments')
@UseGuards(AuthGuard)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}
  @Get() list(@Req() req: ShipmentRequest, @Query() page: ShipmentPageDto) {
    return this.shipments.list(req.user.id, page);
  }
  @Get(':id/temperature') detail(
    @Req() req: ShipmentRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.shipments.detail(req.user.id, id);
  }
  @Get(':id/temperature/history') history(
    @Req() req: ShipmentRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: ShipmentPageDto,
  ) {
    return this.shipments.history(req.user.id, id, page);
  }
  @Get(':id/temperature/events') events(
    @Req() req: ShipmentRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: ShipmentPageDto,
  ) {
    return this.shipments.events(req.user.id, id, page);
  }
}

@Controller('admin/api/shipments')
@UseGuards(AuthGuard, NetworkAdminGuard)
export class AdminShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}
  @Post() create(
    @Req() req: ShipmentRequest,
    @Body() dto: CreateShipmentMonitorDto,
  ) {
    return this.shipments.create(req.user.id, dto);
  }
  @Patch(':id/monitoring') update(
    @Req() req: ShipmentRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShipmentMonitorDto,
  ) {
    return this.shipments.update(req.user.id, id, dto);
  }
  @Post(':id/temperature/sync') sync(
    @Req() req: ShipmentRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.shipments.sync(req.user.id, id);
  }
}
