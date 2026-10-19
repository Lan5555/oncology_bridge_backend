import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { Prescription } from './entities/prescription.entity';
import { PrescriptionsService } from './prescriptions.service';

type FacilityRequest = Request & { user?: { id: string; facilityId?: string } };

@Controller('api/prescriptions')
@UseGuards(AuthGuard, OperationalReadGuard)
export class PrescriptionsController {
  constructor(
    private readonly service: PrescriptionsService,
    private readonly reads: OperationalReadsService,
  ) {}
  @Post() create(
    @Body() body: Partial<Prescription>,
    @Req() req: FacilityRequest,
  ) {
    return this.service.create(body, req.user?.id, req.user?.facilityId);
  }
  @Get() findAll(
    @Query() query: OperationalQueryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.reads.list('prescriptions', req.user?.id, query);
  }

  @Get(':id/events') events(
    @Param('id') id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.service.eventsFor(id, req.user?.facilityId);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() body: Partial<Prescription>,
    @Req() req: FacilityRequest,
  ) {
    return this.service.update(id, body, req.user?.facilityId);
  }
}
