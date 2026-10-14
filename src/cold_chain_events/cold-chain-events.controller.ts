import {
  Controller,
  Get,
  Headers,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { ColdChainEventsService } from './cold-chain-events.service';

interface AuthRequest extends Request {
  user?: { id: string | number; exp?: number };
}

@Controller('api/cold-chain-events')
@UseGuards(AuthGuard)
export class ColdChainEventsController {
  constructor(private readonly service: ColdChainEventsService) {}

  @Get() all(
    @Req() request: AuthRequest,
    @Query('unitId') unitId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.all(String(request.user!.id), {
      unitId,
      status,
      from,
      to,
      page: Number(page),
      limit: Number(limit),
    });
  }
}

@Controller('api/coldchain')
@UseGuards(AuthGuard)
export class ColdChainStreamController {
  constructor(private readonly service: ColdChainEventsService) {}

  @Sse('stream') stream(
    @Req() request: AuthRequest,
    @Headers('last-event-id') lastEventId?: string,
  ) {
    const exp = request.user?.exp ?? Math.floor(Date.now() / 1000) + 15 * 60;
    return this.service.stream(
      String(request.user!.id),
      exp * 1000,
      lastEventId,
    );
  }
}
