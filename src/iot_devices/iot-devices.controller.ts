import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { IotDevicesService } from './iot-devices.service';
import {
  ProvisionIotDeviceDto,
  RotateIotDeviceSecretDto,
} from './dto/provision-iot-device.dto';

interface UserRequest extends Request {
  user?: { id: string | number };
}

@Controller('api/iot/devices')
@UseGuards(AuthGuard)
export class IotDevicesController {
  constructor(private readonly devices: IotDevicesService) {}

  @Get() list(@Req() request: UserRequest) {
    return this.devices.list(String(request.user!.id));
  }

  @Get('metrics') metrics(@Req() request: UserRequest) {
    return this.devices.metrics(String(request.user!.id));
  }

  @Post() create(
    @Req() request: UserRequest,
    @Body() body: ProvisionIotDeviceDto,
  ) {
    return this.devices.create(String(request.user!.id), body);
  }

  @Post(':id/rotate') rotate(
    @Req() request: UserRequest,
    @Param('id') id: string,
    @Body() body: RotateIotDeviceSecretDto,
  ) {
    return this.devices.rotate(String(request.user!.id), id, body.secretRef);
  }

  @Post(':id/revoke') revoke(
    @Req() request: UserRequest,
    @Param('id') id: string,
  ) {
    return this.devices.revoke(String(request.user!.id), id);
  }
}
