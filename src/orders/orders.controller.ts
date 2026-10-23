import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { OrdersService } from './orders.service';
import { FulfillmentDto, OrderQueryDto } from './orders.dto';
import { OrdersResponseFilter } from './orders-response.filter';
type OrderRequest = Request & { user: { id: string } };

@Controller('api/orders')
@UseFilters(OrdersResponseFilter)
@UseGuards(AuthGuard)
export class BuyerOrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() list(@Req() req: OrderRequest, @Query() query: OrderQueryDto) {
    return this.orders.list(req.user.id, query);
  }
  @Get(':orderId') detail(
    @Req() req: OrderRequest,
    @Param('orderId', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.detail(req.user.id, id);
  }
}

@Controller('admin/api/orders')
@UseFilters(OrdersResponseFilter)
@UseGuards(AuthGuard, NetworkAdminGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() list(@Req() req: OrderRequest, @Query() query: OrderQueryDto) {
    return this.orders.list(req.user.id, query, true);
  }
  @Get(':orderId') detail(
    @Req() req: OrderRequest,
    @Param('orderId', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.detail(req.user.id, id, true);
  }
  @Patch(':orderId/fulfillment') fulfill(
    @Req() req: OrderRequest,
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() dto: FulfillmentDto,
  ) {
    return this.orders.fulfill(req.user.id, id, dto, req.ip ?? 'unknown');
  }
}
