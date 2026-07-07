import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { InsuranceRequestService } from './insurance_request.service';
import { CreateInsuranceRequestDto } from './dto/create-insurance_request.dto';
import { UpdateInsuranceRequestDto } from './dto/update-insurance_request.dto';

@Controller('insurance-request')
export class InsuranceRequestController {
  constructor(private readonly insuranceRequestService: InsuranceRequestService) {}

  @Post()
  create(@Body() createInsuranceRequestDto: CreateInsuranceRequestDto) {
    return this.insuranceRequestService.create(createInsuranceRequestDto);
  }

  @Get()
  findAll() {
    return this.insuranceRequestService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.insuranceRequestService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInsuranceRequestDto: UpdateInsuranceRequestDto) {
    return this.insuranceRequestService.update(+id, updateInsuranceRequestDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.insuranceRequestService.remove(+id);
  }
}
