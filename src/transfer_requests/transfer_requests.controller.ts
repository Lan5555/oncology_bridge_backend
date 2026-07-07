import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TransferRequestsService } from './transfer_requests.service';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';

@Controller('transfer-requests')
export class TransferRequestsController {
  constructor(private readonly transferRequestsService: TransferRequestsService) {}

  @Post()
  create(@Body() createTransferRequestDto: CreateTransferRequestDto) {
    return this.transferRequestsService.create(createTransferRequestDto);
  }

  @Get()
  findAll() {
    return this.transferRequestsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transferRequestsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTransferRequestDto: UpdateTransferRequestDto) {
    return this.transferRequestsService.update(+id, updateTransferRequestDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.transferRequestsService.remove(+id);
  }
}
