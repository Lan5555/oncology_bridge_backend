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
import { TransferRequestsService } from './transfer_requests.service';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';

type FacilityRequest = Request & { user?: { facilityId?: string } };

@Controller(['transfer-requests', 'api/transfers'])
@UseGuards(AuthGuard)
export class TransferRequestsController {
  constructor(
    private readonly transferRequestsService: TransferRequestsService,
  ) {}

  @Post()
  create(@Body() createTransferRequestDto: CreateTransferRequestDto, @Req() req: FacilityRequest) {
    return this.transferRequestsService.create(createTransferRequestDto, req.user?.facilityId);
  }

  @Get('stats') stats(@Req() req: FacilityRequest) {
    return this.transferRequestsService.stats(req.user?.facilityId);
  }
  @Get('active-order') activeOrder(@Req() req: FacilityRequest) {
    return this.transferRequestsService.activeOrder(req.user?.facilityId);
  }
  @Get('suggest') suggest(@Query('inventoryItemId') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.suggest(id, req.user?.facilityId);
  }
  @Post(':id/approve') approve(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.decide(id, true, undefined, req.user?.facilityId);
  }
  @Post(':id/reject') reject(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.decide(id, false, undefined, req.user?.facilityId);
  }

  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: FacilityRequest) {
    return this.transferRequestsService.findAll(status, req.user?.facilityId);
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
    return this.transferRequestsService.update(id, updateTransferRequestDto, req.user?.facilityId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: FacilityRequest) {
    return this.transferRequestsService.remove(id, req.user?.facilityId);
  }
}
