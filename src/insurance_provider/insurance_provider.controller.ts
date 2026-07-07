import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { InsuranceProviderService } from './insurance_provider.service';
import { CreateInsuranceProviderDto } from './dto/create-insurance_provider.dto';
import { UpdateInsuranceProviderDto } from './dto/update-insurance_provider.dto';

@Controller('insurance-provider')
export class InsuranceProviderController {
  constructor(private readonly insuranceProviderService: InsuranceProviderService) {}

  @Post()
  create(@Body() createInsuranceProviderDto: CreateInsuranceProviderDto) {
    return this.insuranceProviderService.create(createInsuranceProviderDto);
  }

  @Get()
  findAll() {
    return this.insuranceProviderService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.insuranceProviderService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInsuranceProviderDto: UpdateInsuranceProviderDto) {
    return this.insuranceProviderService.update(+id, updateInsuranceProviderDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.insuranceProviderService.remove(+id);
  }
}
