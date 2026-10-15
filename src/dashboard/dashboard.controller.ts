import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
@Controller('api/dashboard')
@UseGuards(AuthGuard, NetworkAdminGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('summary') summary() {
    return this.dashboard.summary();
  }
  @Get('charts') charts() {
    return this.dashboard.charts();
  }
}

@Controller('api/public')
export class PublicStatsController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('stats') stats() {
    return this.dashboard.publicStats();
  }
}

@UseGuards(AuthGuard)
@Controller('api/reports')
export class ReportsController {
  constructor(private readonly dashboard: DashboardService) {}
  @Post('export') export(@Body() body: any) {
    return this.dashboard.exportReport(body);
  }
}
