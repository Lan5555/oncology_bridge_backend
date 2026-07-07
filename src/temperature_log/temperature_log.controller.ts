import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TemperatureLogService } from './temperature_log.service';
import { CreateTemperatureLogDto } from './dto/create-temperature_log.dto';
import { UpdateTemperatureLogDto } from './dto/update-temperature_log.dto';

@Controller('temperature-log')
export class TemperatureLogController {
  constructor(private readonly temperatureLogService: TemperatureLogService) {}

  @Post()
  create(@Body() createTemperatureLogDto: CreateTemperatureLogDto) {
    return this.temperatureLogService.create(createTemperatureLogDto);
  }

  @Get()
  findAll() {
    return this.temperatureLogService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temperatureLogService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTemperatureLogDto: UpdateTemperatureLogDto) {
    return this.temperatureLogService.update(+id, updateTemperatureLogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.temperatureLogService.remove(+id);
  }
}
