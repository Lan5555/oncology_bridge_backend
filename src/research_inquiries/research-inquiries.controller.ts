import { OperationalReadGuard } from '../guards/operational-read.guard';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ResearchInquiry } from './entities/research-inquiry.entity';
import { ResearchInquiriesService } from './research-inquiries.service';
@Controller('api/research')
export class ResearchInquiriesController {
  constructor(
    private readonly service: ResearchInquiriesService,
    private readonly reads: OperationalReadsService,
  ) {}
  @Get('inquiries')
  @UseGuards(AuthGuard, OperationalReadGuard)
  list(
    @Req() req: Request & { user?: { id: string } },
    @Query() query: OperationalQueryDto,
  ) {
    return this.reads.list('research', req.user?.id, query);
  }
  @Post('inquiries') create(@Body() body: Partial<ResearchInquiry>) {
    return this.service.create(body);
  }
  @Get('stats') stats() {
    return this.service.stats();
  }
}
