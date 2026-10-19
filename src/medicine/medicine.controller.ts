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
  Ip,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { MedicineService } from './medicine.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { MedicineCatalogGuard } from '../guards/medicine-catalog.guard';
import { PatchMedicineCatalogDto } from './dto/patch-medicine-catalog.dto';

type CatalogRequest = Request & { user?: { id: string } };

@Controller(['medicine', 'api/medicines'])
@UseGuards(AuthGuard, OperationalReadGuard)
export class MedicineController {
  constructor(
    private readonly medicineService: MedicineService,
    private readonly reads: OperationalReadsService,
  ) {}

  @Post()
  @UseGuards(MedicineCatalogGuard)
  create(
    @Body() createMedicineDto: CreateMedicineDto,
    @Req() req: CatalogRequest,
  ) {
    return this.medicineService.create(createMedicineDto, req.user!.id);
  }

  @Get() findAll(
    @Query() query: OperationalQueryDto,
    @Req() req: CatalogRequest,
  ) {
    return this.reads.list('medicines', req.user?.id, query);
  }

  @Get('gtin/:gtin') findByGtin(@Param('gtin') gtin: string) {
    return this.medicineService.findByGtin(gtin);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.medicineService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(MedicineCatalogGuard)
  update(
    @Param('id') id: string,
    @Body() updateMedicineDto: PatchMedicineCatalogDto,
    @Req() req: CatalogRequest,
    @Ip() ip: string,
  ) {
    return this.medicineService.update(id, updateMedicineDto, req.user!.id, ip);
  }

  @Delete(':id')
  @UseGuards(MedicineCatalogGuard)
  remove(
    @Param('id') id: string,
    @Req() req: CatalogRequest,
    @Ip() ip: string,
  ) {
    return this.medicineService.remove(id, req.user!.id, ip);
  }
}

@Controller('api/gs1/lookup')
export class Gs1LookupController {
  constructor(private readonly medicineService: MedicineService) {}
  @Get() lookup(@Query('gtin') gtin: string) {
    return this.medicineService.findByGtin(gtin);
  }
}
