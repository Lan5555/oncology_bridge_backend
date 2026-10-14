import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { SettingsService } from './settings.service';
@Controller('api/settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}
  @Get() all() {
    return this.service.all();
  }
  @Put() update(@Body() body: Record<string, unknown>) {
    return this.service.update(body);
  }
}
