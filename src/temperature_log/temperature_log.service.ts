import { Injectable } from '@nestjs/common';
import { CreateTemperatureLogDto } from './dto/create-temperature_log.dto';
import { UpdateTemperatureLogDto } from './dto/update-temperature_log.dto';

@Injectable()
export class TemperatureLogService {
  create(createTemperatureLogDto: CreateTemperatureLogDto) {
    return 'This action adds a new temperatureLog';
  }

  findAll() {
    return `This action returns all temperatureLog`;
  }

  findOne(id: number) {
    return `This action returns a #${id} temperatureLog`;
  }

  update(id: number, updateTemperatureLogDto: UpdateTemperatureLogDto) {
    return `This action updates a #${id} temperatureLog`;
  }

  remove(id: number) {
    return `This action removes a #${id} temperatureLog`;
  }
}
