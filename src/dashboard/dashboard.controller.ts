import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../guards/auth.guard';
import { DashboardReadGuard } from '../guards/dashboard-read.guard';
import type { DashboardRequest } from '../guards/dashboard-read.guard';
import { ReportsService } from './reports.service';
import { OperationalReadGuard } from '../guards/operational-read.guard';
@Controller('api/dashboard')
@UseGuards(AuthGuard, DashboardReadGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('summary') @Header('Cache-Control', 'private, no-store') summary(
    @Req() req: DashboardRequest,
  ) {
    return this.dashboard.summary(req.dashboardScope);
  }
  @Get('charts') @Header('Cache-Control', 'private, no-store') charts(
    @Req() req: DashboardRequest,
  ) {
    return this.dashboard.charts(req.dashboardScope);
  }
}

@Controller('api/public')
export class PublicStatsController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('stats') stats() {
    return this.dashboard.publicStats();
  }
}

@UseGuards(AuthGuard, OperationalReadGuard)
@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Post('export') @Header('Cache-Control', 'private, no-store') export(
    @Body() body: { type?: unknown; from?: unknown; to?: unknown },
    @Req() req: { user: { id: string } },
  ) {
    return this.reports.export(body, req.user.id);
  }
}
