import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
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
  ParseUUIDPipe,
  Header,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { TransferRequestsService } from './transfer_requests.service';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';

type FacilityRequest = Request & { user?: { id: string; facilityId?: string } };

@Controller(['transfer-requests', 'api/transfers'])
@UseGuards(AuthGuard, OperationalReadGuard)
export class TransferRequestsController {
  constructor(
    private readonly transferRequestsService: TransferRequestsService,
    private readonly reads: OperationalReadsService,
  ) {}

  @Post()
  create(
    @Body() createTransferRequestDto: CreateTransferRequestDto,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.create(
      createTransferRequestDto,
      req.user!.id,
    );
  }

  @Get('stats') stats(@Req() req: FacilityRequest) {
    return this.transferRequestsService.stats(req.user?.facilityId);
  }
  @Get('active-order') activeOrder(@Req() req: FacilityRequest) {
    return this.transferRequestsService.activeOrder(req.user?.facilityId);
  }
  @Get('suggest') suggest(
    @Query('inventoryItemId', ParseUUIDPipe) id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.suggest(id, req.user!.id);
  }
  @Post(':id/approve') approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.decide(id, true, req.user!.id);
  }
  @Post(':id/reject') reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.decide(id, false, req.user!.id);
  }

  @Get() @Header('Cache-Control', 'private, no-store') findAll(
    @Query() query: OperationalQueryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.listForActor(req.user!.id, query);
  }

  @Post(':id/dispatch') @Header('Cache-Control', 'private, no-store') dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.move(id, 'dispatch', req.user!.id);
  }
  @Post(':id/deliver') @Header('Cache-Control', 'private, no-store') deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.move(id, 'deliver', req.user!.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.findOne(id, req.user?.facilityId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTransferRequestDto: UpdateTransferRequestDto,
    @Req() req: FacilityRequest,
  ) {
    return this.transferRequestsService.update(
      id,
      updateTransferRequestDto,
      req.user!.id,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.remove(id, req.user!.id);
  }
}
