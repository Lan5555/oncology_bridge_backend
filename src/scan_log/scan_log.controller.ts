import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ScanLogService } from './scan_log.service';
import { CreateScanLogDto } from './dto/create-scan_log.dto';
import { UpdateScanLogDto } from './dto/update-scan_log.dto';

@Controller('scan-log')
export class ScanLogController {
  constructor(private readonly scanLogService: ScanLogService) {}

  @Post()
  create(@Body() createScanLogDto: CreateScanLogDto) {
    return this.scanLogService.create(createScanLogDto);
  }

  @Get()
  findAll() {
    return this.scanLogService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scanLogService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateScanLogDto: UpdateScanLogDto) {
    return this.scanLogService.update(+id, updateScanLogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scanLogService.remove(+id);
  }
}
