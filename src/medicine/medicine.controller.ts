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
import { MedicineService } from './medicine.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';

@Controller(['medicine', 'api/medicines'])
@UseGuards(AuthGuard)
export class MedicineController {
  constructor(private readonly medicineService: MedicineService) {}

  @Post()
  create(@Body() createMedicineDto: CreateMedicineDto) {
    return this.medicineService.create(createMedicineDto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.medicineService.findAll(q);
  }

  @Get('gtin/:gtin') findByGtin(@Param('gtin') gtin: string) {
    return this.medicineService.findByGtin(gtin);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.medicineService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMedicineDto: UpdateMedicineDto,
  ) {
    return this.medicineService.update(id, updateMedicineDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.medicineService.remove(id);
  }
}

@Controller('api/gs1/lookup')
export class Gs1LookupController {
  constructor(private readonly medicineService: MedicineService) {}
  @Get() lookup(@Query('gtin') gtin: string) {
    return this.medicineService.findByGtin(gtin);
  }
}
