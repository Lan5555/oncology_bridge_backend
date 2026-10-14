import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { Prescription } from './entities/prescription.entity';
import { PrescriptionsService } from './prescriptions.service';

@Controller('api/prescriptions')
@UseGuards(AuthGuard)
export class PrescriptionsController {
  constructor(private readonly service: PrescriptionsService) {}
  @Post() create(@Body() body: Partial<Prescription>) {
    return this.service.create(body);
  }
  @Get() findAll(@Query('tab') tab?: string) {
    return this.service.findAll(tab);
  }
  @Get(':id/events') events(@Param('id') id: string) {
    return this.service.eventsFor(id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() body: Partial<Prescription>,
  ) {
    return this.service.update(id, body);
  }
}
