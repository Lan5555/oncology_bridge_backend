import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { TemperatureLogService } from './temperature_log.service';
import { StorageUnitsService } from '../storage_units/storage-units.service';
import { ColdChainEventsService } from '../cold_chain_events/cold-chain-events.service';

interface AuthRequest extends Request {
  user?: { id: string | number };
}

@Controller('api/coldchain')
@UseGuards(AuthGuard)
export class ColdChainController {
  constructor(
    private readonly readings: TemperatureLogService,
    private readonly units: StorageUnitsService,
    private readonly events: ColdChainEventsService,
  ) {}

  @Get('history')
  history(
    @Req() request: AuthRequest,
    @Query('hours') hours?: string,
    @Query('unitId') unitId?: string,
  ) {
    const requestedHours = hours === undefined ? 24 : Number(hours);
    if (!Number.isInteger(requestedHours) || requestedHours < 1)
      throw new BadRequestException('hours must be a positive integer.');
    if (unitId && !/^[0-9a-f-]{36}$/i.test(unitId))
      throw new BadRequestException('unitId must be a UUID.');
    return this.readings.coldChainHistory(
      String(request.user!.id),
      Math.min(720, requestedHours),
      unitId,
    );
  }

  @Get('events')
  eventsList(@Req() request: AuthRequest, @Query('limit') limit?: string) {
    return this.events.all(String(request.user!.id), { limit: Number(limit) });
  }

  @Get('units')
  unitsList(@Req() request: AuthRequest) {
    return this.units.all(String(request.user!.id));
  }
}
