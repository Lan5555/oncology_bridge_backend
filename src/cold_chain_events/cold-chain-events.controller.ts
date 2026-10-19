import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
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
@UseGuards(AuthGuard, OperationalReadGuard)
export class ColdChainEventsController {
  constructor(private readonly reads: OperationalReadsService) {}

  @Get() all(@Req() req: AuthRequest, @Query() query: OperationalQueryDto) {
    return this.reads.list('events', req.user?.id, query);
  }
}

@Controller('api/coldchain')
@UseGuards(AuthGuard, OperationalReadGuard)
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
