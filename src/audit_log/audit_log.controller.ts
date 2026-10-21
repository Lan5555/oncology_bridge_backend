import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { AuditLogService } from './audit_log.service';
import { CreateAuditLogDto } from './dto/create-audit_log.dto';
import { UpdateAuditLogDto } from './dto/update-audit_log.dto';

type AdminRequest = Request & { user: { id: string } };

@Controller(['audit-log', 'api/audit'])
@UseGuards(AuthGuard, NetworkAdminGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Post()
  create(
    @Body() createAuditLogDto: CreateAuditLogDto,
    @Req() req: AdminRequest,
  ) {
    return this.auditLogService.create(createAuditLogDto, req.user.id);
  }

  @Get()
  findAll(
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLogService.findAll({
      type,
      page: Number(page),
      limit: Number(limit),
      actor,
      from,
      to,
    });
  }

  @Get('export.csv') exportCsv(
    @Req() req: AdminRequest,
    @Query('type') type?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLogService.exportCsv(req.user.id, {
      type,
      actor,
      from,
      to,
    });
  }
  @Get('verify') verify() {
    return this.auditLogService.verifyChain();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auditLogService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAuditLogDto: UpdateAuditLogDto,
  ) {
    return this.auditLogService.update(id, updateAuditLogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auditLogService.remove(id);
  }
}
