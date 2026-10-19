import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { FacilityLicenseReviewGuard } from '../guards/facility-license-review.guard';
import { FacilityLicenseLookupDto } from './dto/facility-license-lookup.dto';
import { FacilityLicenseLookupService } from './facility-license-lookup.service';

@Controller('api/facility-membership-requests')
@UseGuards(AuthGuard, FacilityLicenseReviewGuard)
export class FacilityLicenseLookupController {
  constructor(private readonly lookupService: FacilityLicenseLookupService) {}
  @Post(':requestId/license-lookup')
  @HttpCode(200)
  lookup(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() _body: FacilityLicenseLookupDto,
    @Req() req: Request & { user: { id: string } },
    @Ip() ip: string,
  ) {
    return this.lookupService.lookup(requestId, req.user.id, ip);
  }
}
