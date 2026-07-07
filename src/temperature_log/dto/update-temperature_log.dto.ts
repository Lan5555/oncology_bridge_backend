import { PartialType } from '@nestjs/mapped-types';
import { CreateTemperatureLogDto } from './create-temperature_log.dto';

export class UpdateTemperatureLogDto extends PartialType(CreateTemperatureLogDto) {}
