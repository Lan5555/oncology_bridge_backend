import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { VerificationApplicationsService } from './verification-applications.service';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

type AdminRequest = Request & { user: { id: string } };
class DecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
class LegacyDecisionDto extends DecisionDto {
  @IsIn(['VERIFIED', 'REJECTED']) status!: 'VERIFIED' | 'REJECTED';
}

@Controller('admin/api/verifications')
@UseGuards(AuthGuard, NetworkAdminGuard)
export class AdminVerificationController {
  constructor(private readonly service: VerificationApplicationsService) {}
  @Get()
  list(
    @Query('status') status = 'ALL', @Query('page') page?: string,
    @Query('limit') limit?: string, @Query('q') q?: string,
  ) {
    return this.service.adminList({ status, page: Number(page), limit: Number(limit), q });
  }
  @Post(':applicationId/recheck')
  recheck(@Param('applicationId') id: string, @Req() req: AdminRequest) {
    return this.service.recheck(id, req.user.id, req.ip ?? 'unknown');
  }
  @Post(':applicationId/approve')
  approve(@Param('applicationId') id: string, @Req() req: AdminRequest, @Body() body?: DecisionDto) {
    return this.service.decide(id, 'VERIFIED', req.user.id, body?.reason, req.ip);
  }
  @Post(':applicationId/reject')
  reject(@Param('applicationId') id: string, @Req() req: AdminRequest, @Body() body?: DecisionDto) {
    return this.service.decide(id, 'REJECTED', req.user.id, body?.reason, req.ip);
  }
}

// Legacy review routes remain available to existing clients, but are equally restricted.
@Controller('api/verification-applications')
@UseGuards(AuthGuard, NetworkAdminGuard)
export class VerificationApplicationsController {
  constructor(private readonly service: VerificationApplicationsService) {}
  @Get() all(@Query('status') status?: string) { return this.service.all(status); }
  @Post(':id/decision') decide(
    @Param('id') id: string,
    @Body() body: LegacyDecisionDto,
    @Req() req: AdminRequest,
  ) {
    return this.service.decide(id, body.status, req.user.id, body.reason, req.ip);
  }
}
