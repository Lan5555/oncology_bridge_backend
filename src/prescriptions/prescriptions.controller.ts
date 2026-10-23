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
  Header,
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
  @Post() @Header('Cache-Control', 'private, no-store') create(
    @Body() body: Partial<Prescription>,
    @Req() req: FacilityRequest,
  ) {
    return this.service.create(body, req.user?.id, req.user?.facilityId);
  }
  @Get('pharmacies') @Header('Cache-Control', 'private, no-store') pharmacies(
    @Query() query: { page?: string; limit?: string },
    @Req() req: FacilityRequest,
  ) {
    return this.service.pharmacies(req.user!.id, {
      page: query.page === undefined ? 1 : Number(query.page),
      limit: query.limit === undefined ? 100 : Number(query.limit),
    });
  }
  @Get() @Header('Cache-Control', 'private, no-store') findAll(
    @Query() query: OperationalQueryDto,
    @Req() req: FacilityRequest,
  ) {
    return this.reads.list('prescriptions', req.user?.id, query);
  }

  @Get(':id/events') @Header('Cache-Control', 'private, no-store') events(
    @Param('id') id: string,
    @Req() req: FacilityRequest,
  ) {
    return this.service.eventsFor(id, req.user?.facilityId, req.user?.id);
  }
  @Patch(':id') @Header('Cache-Control', 'private, no-store') update(
    @Param('id') id: string,
    @Body() body: Partial<Prescription>,
    @Req() req: FacilityRequest,
  ) {
    return this.service.update(id, body, req.user?.facilityId, req.user?.id);
  }
}
