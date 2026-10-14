import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { VerificationApplication } from './entities/verification-application.entity';
import { VerificationApplicationsService } from './verification-applications.service';
@Controller('api/verification-applications')
export class VerificationApplicationsController {
  constructor(private readonly service: VerificationApplicationsService) {}
  @Post() create(@Body() body: Partial<VerificationApplication>) {
    return this.service.create(body);
  }
  @Get() @UseGuards(AuthGuard) all(@Query('status') status?: string) {
    return this.service.all(status);
  }
  @Post(':id/decision') @UseGuards(AuthGuard) decide(
    @Param('id') id: string,
    @Body() body: { status: string; reviewer_id: string; reason?: string },
  ) {
    return this.service.decide(id, body);
  }
}
