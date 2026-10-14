import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import { IotReadingsService } from './iot-readings.service';

@Controller('iot/readings')
export class IotReadingsController {
  constructor(private readonly readings: IotReadingsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-device-id') deviceId: string,
    @Headers('x-request-timestamp') timestamp: string,
    @Headers('x-request-nonce') nonce: string,
    @Headers('x-request-signature') signature: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    if (process.env.NODE_ENV === 'production' && !request.secure)
      throw new ForbiddenException('IoT ingest requires HTTPS.');
    return this.readings.ingest(
      { deviceId, timestamp, nonce, signature },
      request.rawBody,
      body,
      ip,
    );
  }
}
