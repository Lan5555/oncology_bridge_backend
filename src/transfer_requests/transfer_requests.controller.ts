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
import { TransferRequestsService } from './transfer_requests.service';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';

@Controller(['transfer-requests', 'api/transfers'])
@UseGuards(AuthGuard)
export class TransferRequestsController {
  constructor(
    private readonly transferRequestsService: TransferRequestsService,
  ) {}

  @Post()
  create(@Body() createTransferRequestDto: CreateTransferRequestDto) {
    return this.transferRequestsService.create(createTransferRequestDto);
  }

  @Get('stats') stats() {
    return this.transferRequestsService.stats();
  }
  @Get('active-order') activeOrder() {
    return this.transferRequestsService.activeOrder();
  }
  @Get('suggest') suggest(@Query('inventoryItemId') id: string) {
    return this.transferRequestsService.suggest(id);
  }
  @Post(':id/approve') approve(@Param('id') id: string) {
    return this.transferRequestsService.decide(id, true);
  }
  @Post(':id/reject') reject(@Param('id') id: string) {
    return this.transferRequestsService.decide(id, false);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    return this.transferRequestsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transferRequestsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTransferRequestDto: UpdateTransferRequestDto,
  ) {
    return this.transferRequestsService.update(id, updateTransferRequestDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.transferRequestsService.remove(id);
  }
}
