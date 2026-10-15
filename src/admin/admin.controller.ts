import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { IntegrationAdminGuard } from '../guards/integration-admin.guard';
import { AdminIntegrationsService } from './admin-integrations.service';
import { UpdateIntegrationConfigurationDto } from './dto/update-integration-configuration.dto';

type AdminRequest = Request & { user: { id: string } };

@Controller('admin/api/integrations')
@UseGuards(AuthGuard, NetworkAdminGuard, IntegrationAdminGuard)
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get('health')
  health() {
    return this.integrations.health();
  }

  @Get(':integrationKey/configuration')
  configuration(
    @Param('integrationKey') key: string,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.integrations.configuration(key, req.user.id, ip);
  }

  @Put(':integrationKey/configuration')
  updateConfiguration(
    @Param('integrationKey') key: string,
    @Body() body: UpdateIntegrationConfigurationDto,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.integrations.updateConfiguration(key, body, req.user.id, ip);
  }

  @Post(':integrationKey/test')
  test(
    @Param('integrationKey') key: string,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.integrations.test(key, req.user.id, ip);
  }

  @Post(':integrationKey/sync')
  sync(
    @Param('integrationKey') key: string,
    @Req() req: AdminRequest,
    @Ip() ip: string,
  ) {
    return this.integrations.sync(key, req.user.id, ip);
  }
}
